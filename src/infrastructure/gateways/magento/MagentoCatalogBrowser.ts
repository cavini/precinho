import type {
  CatalogBrowser,
  CatalogSlice,
  SweepPlan,
} from "@/application/ports/CatalogBrowser";
import type { HttpClient } from "@/application/ports/HttpClient";
import type { Logger } from "@/application/ports/Logger";
import type { CatalogSearchResult } from "@/application/ports/StoreCatalogGateway";
import type { RequestBudget } from "@/domain/services/RequestBudget";
import type { MagentoStoreConfig } from "./MagentoCatalogGateway";
import { MagentoCatalogGateway, PRODUCT_FIELDS } from "./MagentoCatalogGateway";

/**
 * Magento has no offset ceiling the way VTEX does, so a slice is simply a
 * category and the only reason to split one is page size.
 */
const DEFAULT_PAGE_SIZE = 200;

const REQUEST_TIMEOUT_MS = 25_000;
const USER_AGENT =
  "precinho-collector/1.0 (+https://github.com/cavini/precinho)";

type CategoryNode = {
  uid?: string;
  id?: number;
  name?: string;
  product_count?: number;
  children?: CategoryNode[];
};

/**
 * Sweeps a Magento catalogue by category.
 *
 * The decisive difference from VTEX: `categoryList` returns `product_count`
 * on every node, so the entire plan costs **one** request. VTEX charges one
 * request per category just to learn its size.
 *
 * That matters here more than anywhere else. Tauste asked us to collect
 * with moderation, and keyword search spends a request to retrieve whatever
 * a single word happens to match — about thirty products. A category page
 * carries two hundred. Browsing is not only more complete, it is the
 * difference between honouring a limited allowance and squandering it.
 */
export class MagentoCatalogBrowser implements CatalogBrowser {
  private readonly gateway: MagentoCatalogGateway;

  constructor(
    private readonly config: MagentoStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {
    this.gateway = new MagentoCatalogGateway(config, http, logger);
  }

  get storeId(): string {
    return this.config.storeId;
  }

  /** Complexity: one request, then O(n) over the tree in memory. */
  async planSweep(): Promise<SweepPlan> {
    const response = await this.request(CATEGORY_TREE_QUERY);

    if (response === null) {
      return { status: "unavailable", reason: "category-tree" };
    }

    const roots = readCategories(response);
    if (roots === null) {
      this.logger.warn("magento.category_tree_unexpected", {
        storeId: this.storeId,
      });
      return { status: "unavailable", reason: "invalid-json" };
    }

    const slices: CatalogSlice[] = [];
    for (const root of roots) {
      collectLeaves(root, slices);
    }

    this.logger.info("magento.sweep_planned", {
      storeId: this.storeId,
      slices: slices.length,
      products: slices.reduce((total, slice) => total + slice.size, 0),
      requestsSpent: 1,
    });

    // Nothing is unreachable: Magento pages a category to the end.
    return { status: "ok", slices, unreachable: [], requestsSpent: 1 };
  }

  /** Complexity: one request; O(n) over the products on the page. */
  async fetchPage(
    slice: CatalogSlice,
    page: number,
  ): Promise<CatalogSearchResult> {
    const pageSize = this.config.pageSize ?? DEFAULT_PAGE_SIZE;

    // Magento counts pages from one, unlike every offset-based API here.
    return this.gateway.searchCategory(slice.id, page + 1, pageSize);
  }

  /** Shares the gateway's budget and pacing; the tree is a request like any other. */
  private async request(query: string): Promise<unknown | null> {
    if (this.config.budget && !this.config.budget.tryConsume()) {
      this.logger.warn("magento.budget_exhausted", {
        storeId: this.storeId,
        spentToday: this.config.budget.spent,
      });
      return null;
    }

    const response = await this.http.getJson(
      `https://${this.config.host}/graphql?${new URLSearchParams({ query })}`,
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          ...(this.config.storeView ? { Store: this.config.storeView } : {}),
        },
      },
    );

    if (response.status !== "ok") {
      this.logger.warn("magento.category_tree_failed", {
        storeId: this.storeId,
        result: response.status,
      });
      return null;
    }

    const body = response.body as {
      errors?: Array<{ message?: unknown }>;
    } | null;
    if (body?.errors?.length) {
      this.logger.warn("magento.graphql_error", {
        storeId: this.storeId,
        message: String(body.errors[0]?.message ?? "").slice(0, 200),
      });
      return null;
    }

    return response.body;
  }
}

/**
 * `product_count` on every node is what makes this one request instead of
 * one per category.
 */
const CATEGORY_TREE_QUERY = `{
  categoryList {
    uid
    name
    product_count
    children {
      uid
      name
      product_count
      children { uid name product_count }
    }
  }
}`;

/** The product fields a page asks for; shared with keyword search. */
export const BROWSE_PRODUCT_FIELDS = PRODUCT_FIELDS;

function readCategories(body: unknown): CategoryNode[] | null {
  if (typeof body !== "object" || body === null) return null;

  const list = (body as { data?: { categoryList?: unknown } }).data
    ?.categoryList;
  return Array.isArray(list) ? (list as CategoryNode[]) : null;
}

/**
 * Walks to the leaves, because a parent's `product_count` includes
 * everything beneath it — sweeping both would fetch the same product twice
 * and spend an allowance doing it.
 *
 * Complexity: O(n) over the tree.
 */
function collectLeaves(node: CategoryNode, into: CatalogSlice[]): void {
  const children = (node.children ?? []).filter(
    (child) => !isMirrorOf(node, child),
  );

  if (children.length > 0) {
    for (const child of children) collectLeaves(child, into);
    return;
  }

  const id = node.uid ?? (node.id === undefined ? null : String(node.id));
  const size = node.product_count ?? 0;
  if (!id || size <= 0) return;

  into.push({ id, label: node.name ?? id, size });
}

/**
 * A second view of everything rather than a department of its own.
 *
 * Tauste publishes one called "Departamentos": childless, carrying all
 * 18,791 products, sitting beside the 24 real departments that already
 * cover them. Sweeping it would have doubled the run and spent on
 * duplicates exactly the allowance they asked us to be careful with.
 *
 * Three conditions, and all three matter. Childless, because a parent is
 * resolved through its children anyway. Holding the whole parent, because
 * that is what makes it a duplicate rather than a big aisle. And having
 * siblings that hold products, because in a shop with a single department
 * that one node *is* the catalogue — dropping it would collect nothing at
 * all.
 */
function isMirrorOf(parent: CategoryNode, child: CategoryNode): boolean {
  if ((child.children ?? []).length > 0) return false;

  const parentSize = parent.product_count ?? 0;
  const childSize = child.product_count ?? 0;
  if (parentSize <= 0 || childSize < parentSize) return false;

  return (parent.children ?? []).some(
    (sibling) => sibling !== child && (sibling.product_count ?? 0) > 0,
  );
}

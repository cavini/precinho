import type {
  CatalogBrowser,
  CatalogSlice,
  SweepPlan,
} from '@/application/ports/CatalogBrowser'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type { CatalogSearchResult } from '@/application/ports/StoreCatalogGateway'
import type { VtexStoreConfig } from './VtexCatalogGateway'
import { VtexCatalogGateway } from './VtexCatalogGateway'

/**
 * VTEX refuses an offset past 2,500 and a window wider than 50, so 2,550 is
 * the most any single filter can yield. A slice larger than that has to be
 * split or part of it is simply unreachable.
 */
export const VTEX_SLICE_CEILING = 2_550

/** The widest page VTEX allows. */
export const VTEX_PAGE_SIZE = 50

/** How deep the category tree is worth asking for; 3 is the full depth. */
const TREE_DEPTH = 3

const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

type TreeNode = {
  id: number
  name: string
  children?: TreeNode[]
}

/**
 * Sweeps a VTEX catalogue by category.
 *
 * Reuses VtexCatalogGateway for the mapping and the pacing — the payload a
 * category filter returns is identical to a keyword search, so none of that
 * needs restating here. This class only works out *what* to ask for.
 *
 * The plan is built by descending lazily. Probing every node of the tree
 * would cost one request per node — 702 of them at Mambo, just to decide
 * what to fetch — so a node is only opened when its own size exceeds the
 * ceiling. In practice that touches a few dozen nodes rather than hundreds.
 */
export class VtexCatalogBrowser implements CatalogBrowser {
  private readonly gateway: VtexCatalogGateway
  private requests = 0

  constructor(
    private readonly config: VtexStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {
    this.gateway = new VtexCatalogGateway(config, http, logger)
  }

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: O(n) requests for n nodes actually probed, which is the
   * tree's top level plus any branch that overflows — far short of the
   * whole tree.
   */
  async planSweep(): Promise<SweepPlan> {
    this.requests = 0

    const tree = await this.fetchTree()
    if (!tree) return { status: 'unavailable', reason: 'category-tree' }

    const slices: CatalogSlice[] = []
    const unreachable: CatalogSlice[] = []

    // Descend from each root's children, keeping the root in the path:
    // VTEX only honours a filter that starts at the root id. The root
    // itself is never probed — it is the whole catalogue and cannot fit
    // under the ceiling, so asking its size would spend a request to learn
    // nothing.
    for (const root of tree) {
      for (const child of root.children ?? []) {
        await this.collectSlices(child, `/${root.id}`, slices, unreachable)
      }
    }

    this.logger.info('vtex.sweep_planned', {
      storeId: this.storeId,
      slices: slices.length,
      unreachable: unreachable.length,
      products: slices.reduce((total, slice) => total + slice.size, 0),
      requestsSpent: this.requests,
    })

    return { status: 'ok', slices, unreachable, requestsSpent: this.requests }
  }

  /** Complexity: one request; O(n) over the products on the page. */
  async fetchPage(slice: CatalogSlice, page: number): Promise<CatalogSearchResult> {
    const from = page * VTEX_PAGE_SIZE
    if (from > 2_500) {
      // Past the platform's ceiling: stop rather than let VTEX 400 at us.
      return { status: 'ok', products: [] }
    }

    return this.gateway.searchCategory(slice.id, from, from + VTEX_PAGE_SIZE - 1)
  }

  /**
   * Adds a node to the plan, or opens it if it is too big.
   *
   * A node that overflows with no children left to open is recorded as
   * unreachable rather than silently truncated.
   */
  private async collectSlices(
    node: TreeNode,
    parentPath: string,
    slices: CatalogSlice[],
    unreachable: CatalogSlice[],
  ): Promise<void> {
    const path = `${parentPath}/${node.id}`
    const size = await this.countProducts(path)

    if (size === null) return
    if (size === 0) return

    const slice: CatalogSlice = { id: path, label: node.name, size }

    if (size <= VTEX_SLICE_CEILING) {
      slices.push(slice)
      return
    }

    const children = node.children ?? []
    if (children.length === 0) {
      unreachable.push(slice)
      // Still sweep what is reachable: 2,550 of an aisle beats none of it.
      slices.push(slice)
      return
    }

    for (const child of children) {
      await this.collectSlices(child, path, slices, unreachable)
    }
  }

  /**
   * Exact product count for a category, for the price of one request that
   * transfers no products: VTEX answers `resources: 0-0/1856`.
   */
  private async countProducts(path: string): Promise<number | null> {
    const response = await this.gateway.countCategory(path)
    this.requests += 1

    if (response === null) {
      this.logger.warn('vtex.category_count_failed', { storeId: this.storeId, path })
    }
    return response
  }

  private async fetchTree(): Promise<TreeNode[] | null> {
    const url = `https://${this.config.host}${this.config.pathPrefix ?? ''}/api/catalog_system/pub/category/tree/${TREE_DEPTH}`

    const response = await this.http.getJson(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    this.requests += 1

    if (response.status !== 'ok' || !Array.isArray(response.body)) {
      this.logger.warn('vtex.category_tree_failed', {
        storeId: this.storeId,
        result: response.status,
      })
      return null
    }

    return response.body as TreeNode[]
  }
}

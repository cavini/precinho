import type { CatalogBrowser, CatalogSlice, SweepPlan } from '@/application/ports/CatalogBrowser'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type { CatalogSearchResult } from '@/application/ports/StoreCatalogGateway'
import type { VipCommerceStoreConfig } from './VipCommerceCatalogGateway'
import { VipCommerceCatalogGateway } from './VipCommerceCatalogGateway'

/**
 * How many products to take per request.
 *
 * Measured rather than guessed: the API honoured limit=250 and returned
 * page 12 of 12 for a 2,771-product department, then an empty page 13. No
 * offset ceiling of the kind VTEX imposes showed up at all.
 */
const PAGE_SIZE = 250

type TreeNode = {
  classificacao_mercadologica_id?: number | string
  descricao?: string
  /** Counts promotions, not products. See the note in planSweep. */
  total_ofertas?: number
}

/**
 * Sweeps a VipCommerce catalogue by department.
 *
 * Departments rather than sections, because the department endpoint already
 * returns everything beneath it — Bebidas answers 2,771 products across its
 * sections — and pages to the end without a ceiling. Descending further
 * would spend a sizing request on each of a couple of hundred sections to
 * fetch exactly the same products.
 *
 * The one trap worth naming: the tree publishes `total_ofertas` on every
 * node, which looks like the count a plan needs. It is not. Bebidas reports
 * 204 there against 2,771 on the paginator, because it counts what is on
 * special offer. A plan built from it would have swept a fourteenth of the
 * shop and reported success, which is the worst kind of wrong answer to get
 * from a catalogue.
 */
export class VipCommerceCatalogBrowser implements CatalogBrowser {
  private readonly gateway: VipCommerceCatalogGateway

  constructor(
    private readonly config: VipCommerceStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {
    this.gateway = new VipCommerceCatalogGateway(config, http, logger)
  }

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: one request for the tree, then one per department to read
   * its true size — 19 in all at Shibata, against the couple of hundred
   * that sizing every section would cost.
   */
  async planSweep(): Promise<SweepPlan> {
    const tree = await this.fetchTree()
    if (tree === 'unavailable') return { status: 'unavailable', reason: 'category-tree' }
    if (tree === null) {
      this.logger.warn('vipcommerce.category_tree_unexpected', { storeId: this.storeId })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const slices: CatalogSlice[] = []
    let requestsSpent = 1

    for (const node of tree) {
      const id = readId(node)
      if (!id) continue

      const size = await this.gateway.countDepartment(id)
      requestsSpent += 1

      // A department the store reports as empty is not worth a page
      // request, and a department it refuses to size is not worth guessing
      // at — the sweep would page blindly into nothing.
      if (size === null || size <= 0) continue

      slices.push({ id, label: node.descricao ?? id, size })
    }

    this.logger.info('vipcommerce.sweep_planned', {
      storeId: this.storeId,
      slices: slices.length,
      products: slices.reduce((total, slice) => total + slice.size, 0),
      requestsSpent,
    })

    // Nothing is unreachable: the API pages a department to its end.
    return { status: 'ok', slices, unreachable: [], requestsSpent }
  }

  /**
   * One page of a department.
   *
   * Complexity: one request; O(n) over the products on the page.
   */
  async fetchPage(slice: CatalogSlice, page: number): Promise<CatalogSearchResult> {
    // VipCommerce counts pages from one, unlike the offset-based APIs here.
    return this.gateway.searchDepartment(slice.id, page + 1, PAGE_SIZE)
  }

  /**
   * The department list: `'unavailable'` when the store would not answer,
   * null when it answered something else than a tree.
   *
   * Complexity: one request.
   */
  private async fetchTree(): Promise<TreeNode[] | null | 'unavailable'> {
    const response = await this.gateway.fetchDepartmentTree()
    if (response === null) return 'unavailable'

    return Array.isArray(response) ? (response as TreeNode[]) : null
  }
}

/** Numbers are accepted: the tree's ids are numeric but read as ids. */
function readId(node: TreeNode): string | null {
  const id = node.classificacao_mercadologica_id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  if (typeof id === 'string' && id.trim() !== '') return id.trim()
  return null
}

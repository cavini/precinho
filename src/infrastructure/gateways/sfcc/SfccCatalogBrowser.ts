import type { CatalogBrowser, CatalogSlice, SweepPlan } from '@/application/ports/CatalogBrowser'
import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type { CatalogSearchResult } from '@/application/ports/StoreCatalogGateway'
import type { SfccStoreConfig } from './SfccCatalogGateway'
import { SfccCatalogGateway } from './SfccCatalogGateway'

/**
 * The widest page Search-UpdateGrid serves. Verified on Nagumo: asking
 * sz=100 against a category of 1,951 returns 100 rows, and the keyword path
 * honours it too.
 */
export const SFCC_PAGE_SIZE = 100

/**
 * Stands in for a size this platform will not tell us up front.
 *
 * Demandware returns the exact category size in `count` on every page, but
 * a plan has to be built before any page is fetched, and spending one
 * request per category to learn 148 numbers costs more than it saves. So
 * each slice is declared larger than any aisle can be and the slice ends
 * when a page comes back short of the window — the rule
 * BrowsingCatalogSource already uses, and the reason it had to learn to
 * recognise a short page rather than buy an empty one.
 */
const UNKNOWN_SIZE = 100_000

export type SfccBrowserConfig = SfccStoreConfig & {
  /**
   * The categories to walk, as Demandware `cgid` values.
   *
   * Recovered from the product URLs already in the database rather than
   * from the storefront: migration 0030 left this chain on keyword sweeps
   * because "the category tree is only published as navigation HTML", and
   * that is still true — but every Nagumo offer URL carries its category
   * path, so 7,144 stored links yield the taxonomy for nothing.
   *
   * The cgid is the LAST segment of that path. The full path returns an
   * empty result; `cgid=commodities` returns 1,951 products.
   */
  categories: readonly string[]
}

/**
 * Sweeps a Salesforce Commerce Cloud catalogue by category.
 *
 * Reuses SfccCatalogGateway for the branch session, the pacing and the
 * mapping. A category request is the same controller with `cgid` where the
 * keyword request puts `q`, so it rides the same branch-bound session and
 * carries the same prices — which is why this needed none of the
 * price-table archaeology the VTEX shops did.
 *
 * What it buys: the keyword sweep kept 24 of the 577 products matching
 * "arroz", 4.2%, and no term on the list reaches an aisle nobody thought
 * to name.
 */
export class SfccCatalogBrowser implements CatalogBrowser {
  private readonly gateway: SfccCatalogGateway

  constructor(
    private readonly config: SfccBrowserConfig,
    http: HttpClient,
    private readonly logger: Logger,
  ) {
    this.gateway = new SfccCatalogGateway(
      { ...config, pageSize: SFCC_PAGE_SIZE },
      http,
      logger,
    )
  }

  get storeId(): string {
    return this.config.storeId
  }

  /** Stated so a short page can end a slice without a request to confirm. */
  get pageSize(): number {
    return SFCC_PAGE_SIZE
  }

  /**
   * Costs no requests at all: the categories arrive in the configuration,
   * already recovered from links we hold.
   *
   * Complexity: O(n) over the configured categories.
   */
  async planSweep(): Promise<SweepPlan> {
    const slices: CatalogSlice[] = this.config.categories.map((cgid) => ({
      id: cgid,
      label: cgid,
      size: UNKNOWN_SIZE,
    }))

    if (slices.length === 0) {
      // A row switched to category mode with no categories would otherwise
      // sweep nothing and report success.
      this.logger.warn('sfcc.no_categories_configured', { storeId: this.storeId })
      return { status: 'unavailable', reason: 'no-categories' }
    }

    this.logger.info('sfcc.sweep_planned', {
      storeId: this.storeId,
      slices: slices.length,
      requestsSpent: 0,
    })

    return { status: 'ok', slices, unreachable: [], requestsSpent: 0 }
  }

  /** Complexity: one request; O(n) over the products on the page. */
  async fetchPage(slice: CatalogSlice, page: number): Promise<CatalogSearchResult> {
    return this.gateway.searchCategory(slice.id, page * SFCC_PAGE_SIZE)
  }
}

import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '@/application/ports/StoreCatalogGateway'

export type GpaStoreConfig = {
  storeId: string
  /** Banner path on the shared API: "pa" for Pão de Açúcar. */
  banner: string
  /**
   * GPA's own numeric store, which is how they regionalise. A different
   * store is a different price, so this is the per-region lever and belongs
   * in the store row.
   */
  gpaStoreId: number
  pageSize?: number
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  nowMs?: () => number
}

const API_BASE = 'https://api.vendas.gpa.digital'
const DEFAULT_PAGE_SIZE = 24
const REQUEST_TIMEOUT_MS = 20_000
const IMAGE_BASE = 'https://static.paodeacucar.com'

const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Reads GPA's storefront API.
 *
 * Neither VTEX nor Magento: GPA runs its own service, and search takes its
 * terms in a POST body rather than a query string. A third platform adapter,
 * which is what the gateway port exists to allow.
 *
 * The browser sends a `userHash` with every search. It is a per-person
 * identifier, it is not required for the catalogue to answer, and a nightly
 * collector has no business carrying somebody's identity, so it is left off.
 */
export class GpaCatalogGateway implements StoreCatalogGateway {
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  constructor(
    private readonly config: GpaStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.config.storeId
  }

  /** Complexity: one request per term, O(n) over the products returned. */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    await this.pace()

    const response = await this.http.postJson(
      `${API_BASE}/${this.config.banner}/search/search`,
      {
        terms: term,
        page: 1,
        sortBy: 'relevance',
        resultsPerPage: this.config.pageSize ?? DEFAULT_PAGE_SIZE,
        allowRedirect: true,
        storeId: this.config.gpaStoreId,
        department: 'ecom',
        customerPlus: true,
        partner: 'fallback',
      },
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          Origin: 'https://www.paodeacucar.com',
          Referer: 'https://www.paodeacucar.com/',
        },
      },
    )

    if (response.status !== 'ok') {
      this.logger.warn('gpa.search_failed', {
        storeId: this.storeId,
        term,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    const products = (response.body as { products?: unknown } | null)?.products
    if (!Array.isArray(products)) {
      this.logger.warn('gpa.unexpected_payload', { storeId: this.storeId, term })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const mapped = products.flatMap((raw) => {
      const product = this.toCatalogProduct(raw)
      return product ? [product] : []
    })

    this.logger.debug('gpa.search_ok', {
      storeId: this.storeId,
      term,
      received: products.length,
      usable: mapped.length,
    })

    return { status: 'ok', products: mapped }
  }

  private toCatalogProduct(raw: unknown): CatalogProduct | null {
    if (typeof raw !== 'object' || raw === null) return null
    const item = raw as Record<string, unknown>

    const name = typeof item.name === 'string' ? item.name : null
    const url = typeof item.urlDetails === 'string' ? item.urlDetails : null
    if (!name || !url) return null

    const price = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null
    if (price === null || price <= 0) return null

    return {
      externalId: String(item.id ?? item.sku ?? url),
      // GPA publishes no barcode — sku is an internal code and attributes
      // come back empty — so these products stay store-local unless the
      // approximate matcher pairs them up.
      ean: null,
      name,
      brand: typeof item.brand === 'string' && item.brand !== '' ? item.brand : null,
      imageUrl: firstImage(item.productImages),
      url,
      priceReais: price,
      // GPA's search returns the selling price only; a struck-through price
      // would be a promotion we cannot see from here.
      listPriceReais: null,
      inStock: item.stock !== false,
    }
  }

  /** Same courtesy gap as the other gateways; see the VTEX one. */
  private async pace(): Promise<void> {
    const interval = this.config.minIntervalMs
    if (!interval) return

    const now = this.config.nowMs?.() ?? Date.now()
    const waitFor = this.lastRequestAtMs + interval - now
    if (waitFor > 0) {
      const sleep = this.config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
      await sleep(waitFor)
    }
    this.lastRequestAtMs = this.config.nowMs?.() ?? Date.now()
  }
}

/** Images come back as site-relative paths, so they need the asset host. */
function firstImage(images: unknown): string | null {
  if (!Array.isArray(images) || images.length === 0) return null

  const first = images[0]
  if (typeof first !== 'string' || first === '') return null

  return first.startsWith('http') ? first : `${IMAGE_BASE}${first}`
}

import type { HttpClient } from '@/application/ports/HttpClient'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
  StoreRegionResolver,
} from '@/application/ports/StoreCatalogGateway'
import type { Logger } from '@/application/ports/Logger'
import type { PostalCode } from '@/domain/value-objects/PostalCode'

export type VtexStoreConfig = {
  storeId: string
  /**
   * e.g. "www.mambo.com.br".
   *
   * May also be the chain's VTEX account host
   * ("<account>.vtexcommercestable.com.br"), which serves the same public
   * catalogue without the storefront's custom routing in front of it. The
   * account name is visible in any asset URL as "<account>.vtexassets.com".
   */
  host: string
  /**
   * Some storefronts mount the catalogue API under a prefix — Atacadão
   * serves it at /io/api/catalog_system/... — so the store row carries the
   * prefix instead of the code special-casing a chain.
   */
  pathPrefix?: string
  /** VTEX sales channel; stores that use more than one need it pinned. */
  salesChannel?: string
  /**
   * Trading-area token from the regions endpoint. Without it the catalogue
   * answers with default-area prices, which are not the prices a shopper at
   * this CEP would pay.
   */
  regionToken?: string
  /** How many products to ask for per term. */
  pageSize?: number
  /**
   * Minimum gap between requests to this store. Thirty search terms fired
   * back to back from one address looks like an attack and gets the
   * collector blocked, which costs far more than the time it saves.
   */
  minIntervalMs?: number
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>
  /** Injected so pacing is testable without a real clock. */
  nowMs?: () => number
}

const DEFAULT_PAGE_SIZE = 24
const REQUEST_TIMEOUT_MS = 15_000

/**
 * Identifying ourselves honestly. A catalogue endpoint that wants to refuse
 * this traffic should be able to see who it is and do so.
 */
const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Reads a VTEX storefront catalogue.
 *
 * Most Brazilian grocery chains run on VTEX, and its public catalogue
 * endpoint returns the three things a comparison needs: a barcode, a price,
 * and a link to the product page. One gateway therefore serves many chains —
 * a new store is a config row.
 *
 * The endpoint pages with a Range-style `_from`/`_to` and answers 206, which
 * is a success here, not a partial failure.
 */
export class VtexCatalogGateway implements StoreCatalogGateway, StoreRegionResolver {
  constructor(
    private readonly config: VtexStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  // Negative infinity, not zero: the first request to a store has nothing to
  // wait for, and starting at zero made it sit out a full interval.
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Waits out the remainder of the configured gap since the last request to
   * this store. No-op when no gap is configured, which is how the website
   * (one request, on demand) differs from the collector (thirty in a row).
   */
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

  /**
   * Complexity: O(n) over the products returned; one request per term.
   */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    await this.pace()

    const response = await this.http.getJson(this.searchUrl(term), {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })

    if (response.status !== 'ok') {
      this.logger.warn('vtex.search_failed', {
        storeId: this.storeId,
        term,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    if (!Array.isArray(response.body)) {
      this.logger.warn('vtex.unexpected_payload', { storeId: this.storeId, term })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = response.body.flatMap((raw) => {
      const mapped = toCatalogProduct(raw)
      return mapped ? [mapped] : []
    })

    this.logger.debug('vtex.search_ok', {
      storeId: this.storeId,
      term,
      received: response.body.length,
      usable: products.length,
    })

    return { status: 'ok', products }
  }

  /**
   * Asks the store which trading area a CEP falls in. The answer also names
   * the branch that serves it, which is why prices differ between CEPs at
   * all.
   */
  async resolveRegion(
    postalCode: PostalCode,
  ): Promise<{ regionToken: string; sellerIds: readonly string[] } | null> {
    // No default sales channel: Carrefour's account answers 206 without one
    // and 401 with sc=1, so guessing a channel is worse than omitting it.
    const params = new URLSearchParams({ country: 'BRA', postalCode: postalCode.digits })
    if (this.config.salesChannel) params.set('sc', this.config.salesChannel)

    const url = `${this.base}/api/checkout/pub/regions?${params}`

    const response = await this.http.getJson(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })

    if (response.status !== 'ok' || !Array.isArray(response.body) || response.body.length === 0) {
      this.logger.warn('vtex.region_unresolved', {
        storeId: this.storeId,
        result: response.status,
      })
      return null
    }

    const [first] = response.body as Array<{ id?: unknown; sellers?: unknown }>
    if (typeof first?.id !== 'string' || first.id === '') return null

    const sellerIds = Array.isArray(first.sellers)
      ? first.sellers
          .map((seller) => (seller as { id?: unknown })?.id)
          .filter((id): id is string => typeof id === 'string')
      : []

    return { regionToken: first.id, sellerIds }
  }

  private searchUrl(term: string): string {
    const pageSize = this.config.pageSize ?? DEFAULT_PAGE_SIZE
    const params = new URLSearchParams({
      ft: term,
      _from: '0',
      _to: String(pageSize - 1),
    })
    if (this.config.salesChannel) params.set('sc', this.config.salesChannel)
    if (this.config.regionToken) params.set('regionId', this.config.regionToken)

    // URLSearchParams writes a space as "+", and some VTEX storefronts
    // answer 400 to that — Mambo rejects "queijo+mussarela" and accepts
    // "queijo%20mussarela". Safe to rewrite every "+" in the output, because
    // a literal plus in a value has already been escaped to %2B by then, so
    // the only ones left are spaces.
    const query = params.toString().replace(/\+/g, '%20')

    return `${this.base}/api/catalog_system/pub/products/search?${query}`
  }

  /** Scheme, host and any mount prefix the storefront puts the API behind. */
  private get base(): string {
    return `https://${this.config.host}${this.config.pathPrefix ?? ''}`
  }
}

/**
 * Maps one raw catalogue entry, or returns null when it cannot be priced.
 *
 * VTEX reports an unpriced or unlisted item as Price 0 rather than omitting
 * it, so a zero price is a row to drop, not a free product.
 */
function toCatalogProduct(raw: unknown): CatalogProduct | null {
  if (!isRecord(raw)) return null

  const item = firstOf(raw.items)
  if (!isRecord(item)) return null

  const seller = firstOf(item.sellers)
  if (!isRecord(seller)) return null

  const offer = seller.commertialOffer
  if (!isRecord(offer)) return null

  const price = asNumber(offer.Price)
  if (price === null || price <= 0) return null

  const url = asString(raw.link)
  if (!url) return null

  const listPrice = asNumber(offer.ListPrice) ?? asNumber(offer.PriceWithoutDiscount)
  const available = asNumber(offer.AvailableQuantity) ?? 0

  return {
    externalId: asString(raw.productId) ?? asString(item.itemId) ?? url,
    ean: asString(item.ean),
    name: asString(raw.productName) ?? asString(item.name) ?? '',
    brand: asString(raw.brand),
    imageUrl: asString(
      firstOf(item.images) && (firstOf(item.images) as Record<string, unknown>).imageUrl,
    ),
    url,
    priceReais: price,
    // Only a list price above the selling price is a promotion.
    listPriceReais: listPrice !== null && listPrice > price ? listPrice : null,
    inStock: available > 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

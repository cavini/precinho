import type { HttpClient, HttpJsonResponse } from '@/application/ports/HttpClient'
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
   * Public domain to build product links on.
   *
   * Reading through an account host makes VTEX return links on that host,
   * and those redirect a shopper to an admin login. The link is the whole
   * point of the comparison, so when the two differ this is the one that
   * reaches a shop.
   */
  storefrontHost?: string
  /**
   * Some storefronts mount the catalogue API under a prefix — Atacadão
   * serves it at /io/api/catalog_system/... — so the store row carries the
   * prefix instead of the code special-casing a chain.
   */
  pathPrefix?: string
  /** VTEX sales channel; stores that use more than one need it pinned. */
  salesChannel?: string
  /**
   * Trading-area token from the regions endpoint.
   *
   * Only Intelligent Search honours it. The older catalogue endpoint
   * accepts the parameter and ignores it, which is how this collector
   * spent weeks storing Carrefour's default sales policy — 28.99 for a
   * bag of rice the shop sells at 22.99 — under a regional label.
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

    return this.toSearchResult(response, term)
  }

  /**
   * Maps a catalogue response, whatever asked for it.
   *
   * Keyword search and category browsing return byte-identical payloads, so
   * they share this — the only difference between them is the query string.
   *
   * Complexity: O(n) over the products returned.
   */
  private toSearchResult(response: HttpJsonResponse, asked: string): CatalogSearchResult {
    if (response.status !== 'ok') {
      this.logger.warn('vtex.search_failed', {
        storeId: this.storeId,
        term: asked,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    // Two shapes, because the two endpoints disagree: the catalogue
    // returns a bare array, Intelligent Search wraps it in `products`.
    const raws = readProducts(response.body)
    if (raws === null) {
      this.logger.warn('vtex.unexpected_payload', { storeId: this.storeId, term: asked })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = raws.flatMap((raw) => {
      const mapped = toCatalogProduct(raw, this.config.storefrontHost, this.config.host)
      return mapped ? [mapped] : []
    })

    this.logger.debug('vtex.search_ok', {
      storeId: this.storeId,
      term: asked,
      received: raws.length,
      usable: products.length,
    })

    return { status: 'ok', products }
  }

  /**
   * Exact size of a category, for one request that transfers no products.
   *
   * VTEX answers a zero-width window with a `resources: 0-0/1856` header,
   * which is what makes planning a sweep affordable — otherwise sizing the
   * tree would mean downloading it.
   *
   * Complexity: one request; O(1) parsing.
   */
  async countCategory(categoryPath: string): Promise<number | null> {
    await this.pace()

    const response = await this.http.getJson(
      this.catalogUrl({ fq: categoryFilter(categoryPath), _from: '0', _to: '0' }),
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
    )

    if (response.status !== 'ok') return null

    // "0-0/1856" — the part after the slash is the whole category.
    const total = response.headers.resources?.split('/')[1]
    const parsed = Number(total)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
  }

  /**
   * One window of a category, mapped exactly like a keyword search — the
   * payloads are identical, which is why browsing needed no new parser.
   *
   * Complexity: one request, O(n) over the products returned.
   */
  async searchCategory(
    categoryPath: string,
    from: number,
    to: number,
  ): Promise<CatalogSearchResult> {
    await this.pace()

    const response = await this.http.getJson(
      this.catalogUrl({ fq: categoryFilter(categoryPath), _from: String(from), _to: String(to) }),
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
    )

    return this.toSearchResult(response, categoryPath)
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

  /**
   * Intelligent Search rather than the catalogue endpoint, because it is
   * the only one that prices for a region.
   *
   * Measured against Carrefour: the catalogue endpoint answers 4.49 for
   * Camil 1kg with a region token and 4.49 without, while the storefront
   * quotes 5.19 to somebody in São Paulo. Seven of seven prices checked
   * were wrong, by as much as six reais on a single item.
   */
  private searchUrl(term: string): string {
    const pageSize = this.config.pageSize ?? DEFAULT_PAGE_SIZE
    return this.storefrontUrl({ query: term, from: '0', to: String(pageSize - 1) })
  }

  /** Complexity: O(1) string building. */
  private storefrontUrl(query: Record<string, string>): string {
    const params = new URLSearchParams({ ...query, locale: 'pt-BR' })
    if (this.config.salesChannel) params.set('sc', this.config.salesChannel)
    if (this.config.regionToken) params.set('regionId', this.config.regionToken)

    const encoded = params.toString().replace(/\+/g, '%20')

    // No trailing slash before the query: Atacadão answers 308 to one, and
    // a redirect the collector does not follow reads as a dead store.
    return `${this.base}/api/io/_v/api/intelligent-search/product_search?${encoded}`
  }

  /** Every catalogue call shares the sales channel and the trading area. */
  private catalogUrl(query: Record<string, string>): string {
    const params = new URLSearchParams(query)
    if (this.config.salesChannel) params.set('sc', this.config.salesChannel)
    if (this.config.regionToken) params.set('regionId', this.config.regionToken)

    // URLSearchParams writes a space as "+", and some VTEX storefronts
    // answer 400 to that — Mambo rejects "queijo+mussarela" and accepts
    // "queijo%20mussarela". Safe to rewrite every "+" in the output, because
    // a literal plus in a value has already been escaped to %2B by then, so
    // the only ones left are spaces.
    const encoded = params.toString().replace(/\+/g, '%20')

    return `${this.base}/api/catalog_system/pub/products/search?${encoded}`
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
/** Both endpoint shapes, or null when the payload is neither. */
function readProducts(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  if (isRecord(body) && Array.isArray(body.products)) return body.products
  return null
}

function toCatalogProduct(
  raw: unknown,
  storefrontHost?: string,
  host?: string,
): CatalogProduct | null {
  if (!isRecord(raw)) return null

  const item = firstOf(raw.items)
  if (!isRecord(item)) return null

  const seller = firstOf(item.sellers)
  if (!isRecord(seller)) return null

  const offer = seller.commertialOffer
  if (!isRecord(offer)) return null

  const price = asNumber(offer.Price)
  if (price === null || price <= 0) return null

  const url = publicUrl(asString(raw.link), storefrontHost, host)
  if (!url) return null

  const listPrice = asNumber(offer.ListPrice) ?? asNumber(offer.PriceWithoutDiscount)
  const available = asNumber(offer.AvailableQuantity) ?? 0

  return {
    externalId: asString(raw.productId) ?? asString(item.itemId) ?? url,
    ean: asString(item.ean),
    name: asString(raw.productName) ?? asString(item.name) ?? '',
    description: asString(raw.description) ?? asString(raw.metaTagDescription),
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

/**
 * Moves a link onto the public storefront, keeping path and query intact.
 *
 * Returns null for anything unparseable, so a row with a broken link is
 * dropped rather than stored — Offer would refuse it later anyway, and
 * failing here keeps the reason close to the cause.
 *
 * Complexity: O(n) in the URL length.
 */
/**
 * Intelligent Search returns a path ("/arroz-camil-1kg/p") where the
 * catalogue endpoint returned a whole URL, so a host has to be put back on
 * before the link reaches a shopper.
 */
function publicUrl(link: string | null, storefrontHost?: string, host?: string): string | null {
  if (!link) return null

  const origin = storefrontHost ?? host
  if (link.startsWith('/')) return origin ? `https://${origin}${link}` : null

  if (!storefrontHost) return link

  try {
    const parsed = new URL(link)
    parsed.host = storefrontHost
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Builds the category filter VTEX actually honours.
 *
 * The path has to start at the root id and end in a slash: `C:/1589/1599/`
 * returns 6,903 products at Mambo, while `C:1599` and `C:/1599/` both
 * return zero without erroring — a silent empty result, which is the worst
 * kind of wrong answer to get from a catalogue.
 */
function categoryFilter(categoryPath: string): string {
  return `C:${categoryPath.endsWith('/') ? categoryPath : `${categoryPath}/`}`
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

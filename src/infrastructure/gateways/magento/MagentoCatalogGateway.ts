import type { HttpClient, HttpJsonResponse } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '@/application/ports/StoreCatalogGateway'
import type { RequestBudget } from '@/domain/services/RequestBudget'

export type MagentoStoreConfig = {
  storeId: string
  /** e.g. "tauste.com.br" */
  host: string
  /**
   * Magento store view, sent as the `Store` header. This is how a chain
   * prices per city — Tauste runs one view per town — so collecting without
   * it records whichever view is default rather than the region's prices.
   */
  storeView?: string
  /** Suffix Magento appends to product URLs; ".html" on a default install. */
  urlSuffix?: string
  pageSize?: number
  /**
   * How many requests this store has agreed to receive today.
   *
   * Tauste granted access on condition of twenty a day. Honouring that is
   * the gateway's job rather than the caller's, because the gateway is the
   * only place every request has to pass through.
   */
  budget?: RequestBudget
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  nowMs?: () => number
}

/**
 * Larger than the other platforms' default on purpose.
 *
 * Where a store caps our daily requests, each one has to carry as much as
 * it can: twenty requests of 200 products cover a catalogue, twenty of 24
 * barely scratch it.
 */
const DEFAULT_PAGE_SIZE = 200
const DEFAULT_URL_SUFFIX = '.html'
const REQUEST_TIMEOUT_MS = 15_000

const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Only the fields the comparison needs. Deliberately small: a broad query on
 * somebody else's GraphQL endpoint is both slower for them and more likely
 * to hit a field their schema does not expose.
 *
 * Note what is missing — there is no barcode. Magento keeps EAN as a custom
 * attribute and this schema does not publish one, so products read here
 * cannot be merged across stores on a verified GTIN; they fall back to the
 * approximate matcher.
 */
export const PRODUCT_FIELDS = `
  name
  sku
  url_key
  short_description { html }
  stock_status
  price_range {
    minimum_price {
      final_price { value }
      regular_price { value }
    }
  }
  small_image { url }
`

/**
 * Reads a Magento 2 storefront through its public GraphQL endpoint.
 *
 * Magento publishes catalogue queries without authentication, which is the
 * same data the chain's own storefront renders. A second platform adapter
 * rather than a special case inside the VTEX one: that is the whole reason
 * StoreCatalogGateway is an interface.
 */
export class MagentoCatalogGateway implements StoreCatalogGateway {
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  constructor(
    private readonly config: MagentoStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: one request per term, O(n) over the products returned.
   */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    // Checked before pacing: there is no point waiting out an interval to
    // make a request we are not allowed to make.
    if (this.config.budget && !this.config.budget.tryConsume()) {
      this.logger.warn('magento.budget_exhausted', {
        storeId: this.storeId,
        term,
        spentToday: this.config.budget.spent,
      })
      return { status: 'unavailable', reason: 'budget-exhausted' }
    }

    await this.pace()

    const response = await this.http.getJson(this.queryUrl(term), {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(this.config.storeView ? { Store: this.config.storeView } : {}),
      },
    })

    return this.toSearchResult(response, term)
  }

  /**
   * Maps a catalogue response, whatever asked for it. Keyword search and
   * category browsing return the same shape.
   *
   * Complexity: O(n) over the products returned.
   */
  private toSearchResult(response: HttpJsonResponse, asked: string): CatalogSearchResult {
    if (response.status !== 'ok') {
      this.logger.warn('magento.search_failed', {
        storeId: this.storeId,
        term: asked,
        result: response.status,
      })
      return { status: 'unavailable', reason: response.status }
    }

    const body = response.body as {
      errors?: Array<{ message?: unknown }>
      data?: { products?: { items?: unknown } }
    } | null

    // GraphQL answers 200 with an errors array, so a failed query looks like
    // a success at the HTTP layer.
    if (body?.errors?.length) {
      this.logger.warn('magento.graphql_error', {
        storeId: this.storeId,
        term: asked,
        message: String(body.errors[0]?.message ?? '').slice(0, 200),
      })
      return { status: 'unavailable', reason: 'graphql-error' }
    }

    const items = body?.data?.products?.items
    if (!Array.isArray(items)) {
      this.logger.warn('magento.unexpected_payload', { storeId: this.storeId, term: asked })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = items.flatMap((raw) => {
      const mapped = this.toCatalogProduct(raw)
      return mapped ? [mapped] : []
    })

    this.logger.debug('magento.search_ok', {
      storeId: this.storeId,
      term: asked,
      received: items.length,
      usable: products.length,
    })

    return { status: 'ok', products }
  }

  /**
   * One page of a category.
   *
   * Magento numbers pages from one and has no offset ceiling, so a category
   * pages to its end however large it is — unlike VTEX, which refuses an
   * offset past 2,500.
   *
   * Complexity: one request, O(n) over the products returned.
   */
  /**
   * A product link that lands in the right town.
   *
   * Magento serves each store view under its own path segment, and
   * without it the shop falls back to its default: a Taubaté price linked
   * to tauste.com.br/{produto}.html opens Marília's page, which is a
   * different price for the same product. Verified in a browser — a
   * plain fetch of either form is redirected home by their branch module,
   * so this is not visible from curl.
   *
   * Complexity: O(1).
   */
  private productUrl(urlKey: string, suffix: string): string {
    const prefix = this.config.storeView ? `${this.config.storeView}/` : ''
    return `https://${this.config.host}/${prefix}${urlKey}${suffix}`
  }

  async searchCategory(
    categoryUid: string,
    page: number,
    pageSize: number,
  ): Promise<CatalogSearchResult> {
    if (this.config.budget && !this.config.budget.tryConsume()) {
      this.logger.warn('magento.budget_exhausted', {
        storeId: this.storeId,
        category: categoryUid,
        spentToday: this.config.budget.spent,
      })
      return { status: 'unavailable', reason: 'budget-exhausted' }
    }

    await this.pace()

    const query = `{ products(filter: { category_uid: { eq: ${JSON.stringify(categoryUid)} } }, pageSize: ${pageSize}, currentPage: ${page}) { items { ${PRODUCT_FIELDS} } } }`

    const response = await this.http.getJson(
      `https://${this.config.host}/graphql?${new URLSearchParams({ query })}`,
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(this.config.storeView ? { Store: this.config.storeView } : {}),
        },
      },
    )

    return this.toSearchResult(response, categoryUid)
  }

  /**
   * The query travels in the query string so the request stays a GET, which
   * is cacheable and is what the HttpClient port exposes. Magento accepts
   * both.
   */
  private queryUrl(term: string): string {
    const pageSize = this.config.pageSize ?? DEFAULT_PAGE_SIZE
    // Escaped as a JSON string, so a quote in the term cannot break out of
    // the GraphQL literal.
    const query = `{ products(search: ${JSON.stringify(term)}, pageSize: ${pageSize}) { items { ${PRODUCT_FIELDS} } } }`

    return `https://${this.config.host}/graphql?${new URLSearchParams({ query })}`
  }

  private toCatalogProduct(raw: unknown): CatalogProduct | null {
    if (typeof raw !== 'object' || raw === null) return null
    const item = raw as Record<string, unknown>

    const name = typeof item.name === 'string' ? item.name : null
    const urlKey = typeof item.url_key === 'string' ? item.url_key : null
    if (!name || !urlKey) return null

    const minimum = (item.price_range as { minimum_price?: Record<string, unknown> } | undefined)
      ?.minimum_price
    const price = numberAt(minimum?.final_price)
    if (price === null || price <= 0) return null

    const regular = numberAt(minimum?.regular_price)
    const suffix = this.config.urlSuffix ?? DEFAULT_URL_SUFFIX

    return {
      externalId: typeof item.sku === 'string' ? item.sku : urlKey,
      // Magento does not publish a barcode here; these stay store-local.
      ean: null,
      name,
      description:
        typeof (item.short_description as { html?: unknown } | undefined)?.html === 'string'
          ? (item.short_description as { html: string }).html
          : null,
      brand: null,
      imageUrl:
        typeof (item.small_image as { url?: unknown } | undefined)?.url === 'string'
          ? (item.small_image as { url: string }).url
          : null,
      url: this.productUrl(urlKey, suffix),
      priceReais: price,
      listPriceReais: regular !== null && regular > price ? regular : null,
      inStock: item.stock_status === 'IN_STOCK',
    }
  }

  /** Same courtesy gap as the VTEX gateway; see its note. */
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

/** Reads `{ value: number }`, which is how Magento wraps every money field. */
function numberAt(node: unknown): number | null {
  if (typeof node !== 'object' || node === null) return null
  const value = (node as { value?: unknown }).value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

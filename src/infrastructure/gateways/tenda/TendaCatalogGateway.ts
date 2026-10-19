import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '@/application/ports/StoreCatalogGateway'

export type TendaStoreConfig = {
  storeId: string
  /** Tenda's public API host; overridable so a test or a staging run can aim elsewhere. */
  apiHost?: string
  /**
   * Branch whose shelf decides whether a product counts as in stock.
   *
   * Tenda prices nationally but stocks per branch, and every search row
   * carries the full `inventory` array, so the branch is the only thing that
   * turns a chain-wide "in_stock" into an answer for a shopper at one CEP.
   * Leave it unset to take the chain-wide flag instead.
   */
  branchId?: string
  /**
   * Minimum gap between requests to this store. Thirty search terms fired
   * back to back looks like an attack and gets the collector blocked, which
   * costs far more than the time it saves.
   */
  minIntervalMs?: number
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>
  /** Injected so pacing is testable without a real clock. */
  nowMs?: () => number
}

const DEFAULT_API_HOST = 'api.tendaatacado.com.br'
const SEARCH_PATH = '/api/public/store/search'

/**
 * The storefront's canonical host. The API hands back product links on the
 * bare domain, which 301s to this one, so rewriting here spares every stored
 * link a redirect.
 */
const SITE_HOST = 'www.tendaatacado.com.br'

const REQUEST_TIMEOUT_MS = 15_000

/**
 * Identifying ourselves honestly. A catalogue endpoint that wants to refuse
 * this traffic should be able to see who it is and do so.
 */
const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Reads Tenda Atacado's catalogue through the JSON search endpoint its own
 * storefront calls.
 *
 * Tenda is neither VTEX nor Magento — it is a bespoke Next.js front end over
 * a REST API — so it gets its own adapter rather than a special case inside
 * one of the others. Its `robots.txt` disallows the HTML search page at
 * `/busca?q=`; this endpoint is a different host and path and is not
 * disallowed, and it is also the cheaper thing to ask for, since it answers
 * a whole term in one request where the HTML page would cost a megabyte.
 *
 * Unlike Magento, this catalogue does publish a barcode, which is what lets
 * Tenda's rows merge with other stores' on a verified GTIN instead of
 * falling back to the approximate matcher.
 */
export class TendaCatalogGateway implements StoreCatalogGateway {
  // Negative infinity, not zero: the first request to a store has nothing to
  // wait for, and starting at zero made it sit out a full interval.
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  constructor(
    private readonly config: TendaStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: one request per term. O(n) over the products returned with
   * no branch configured, O(n·b) with one, where b is the branches a product
   * lists — bounded by Tenda's store count, so linear in practice.
   */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    await this.pace()

    const response = await this.http.getJson(this.searchUrl(term), {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })

    if (response.status !== 'ok') {
      this.logger.warn('tenda.search_failed', {
        storeId: this.storeId,
        term,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    const body = response.body as { products?: unknown } | null
    const items = body?.products

    // A term that matches nothing still answers 200 with an empty array, so
    // only a missing or non-array `products` means the shape changed.
    if (!Array.isArray(items)) {
      this.logger.warn('tenda.unexpected_payload', { storeId: this.storeId, term })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = items.flatMap((raw) => {
      const mapped = this.toCatalogProduct(raw)
      return mapped ? [mapped] : []
    })

    this.logger.debug('tenda.search_ok', {
      storeId: this.storeId,
      term,
      received: items.length,
      usable: products.length,
    })

    return { status: 'ok', products }
  }

  /**
   * The API fixes the page at twenty rows and ignores every page-size
   * parameter the front-end bundle knows about, so there is nothing to
   * configure. One page per term is the same depth the other gateways take;
   * `total_pages` in the body is there if a later sweep needs more.
   */
  private searchUrl(term: string): string {
    const params = new URLSearchParams({
      query: term,
      page: '1',
      // The default the storefront sends. Pinned rather than omitted so a
      // change of default upstream cannot quietly reorder our results.
      order: 'relevance',
    })

    // Deliberately no `save=true`. The storefront sends it so the term feeds
    // Tenda's "most searched" list; a collector sweeping the same basket
    // nightly would skew that, and we are not entitled to.
    return `https://${this.config.apiHost ?? DEFAULT_API_HOST}${SEARCH_PATH}?${params}`
  }

  /**
   * Maps one search row, or returns null when it cannot be priced or linked.
   *
   * Complexity: O(b) in the branches the row lists when a branch is
   * configured, O(1) otherwise.
   */
  private toCatalogProduct(raw: unknown): CatalogProduct | null {
    if (!isRecord(raw)) return null

    const name = asString(raw.name)
    if (!name) return null

    const url = canonicalUrl(asString(raw.url))
    if (!url) return null

    const price = asNumber(raw.price)
    if (price === null || price <= 0) return null

    return {
      externalId: asString(raw.sku) ?? asString(raw.id) ?? url,
      // Tenda publishes a real barcode here, but it also puts internal codes
      // in the same field — a tyre came back as "7847043". Passed through
      // raw: verifying the check digit is the domain's job, not ours.
      ean: asString(raw.barcode),
      name,
      brand: asString(raw.brand),
      imageUrl: asString(raw.thumbnail) ?? firstPhotoUrl(raw.photos),
      url,
      priceReais: price,
      // No list price exists to report. What Tenda publishes alongside the
      // shelf price is `promotions` (cheaper, but only in the app and on
      // their own card) and `wholesalePrices` (cheaper, but only from three
      // units up). Both are lower than `price`, so neither is the struck-out
      // original this field means, and `price` stays the one figure anybody
      // pays for a single unit.
      listPriceReais: null,
      inStock: this.isInStock(raw),
    }
  }

  /**
   * Chain-wide availability unless a branch is configured, in which case
   * only that branch's shelf counts — a branch the row does not list holds
   * none of it.
   */
  private isInStock(raw: Record<string, unknown>): boolean {
    const branchId = this.config.branchId
    if (!branchId) return raw.availability === 'in_stock'

    const inventory = Array.isArray(raw.inventory) ? raw.inventory : []
    const entry = inventory.find(
      (candidate) => isRecord(candidate) && asString(candidate.branchId) === branchId,
    )

    return isRecord(entry) && (asNumber(entry.totalAvailable) ?? 0) > 0
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

/**
 * Moves a product link onto the canonical host, and drops anything that is
 * not a URL at all rather than storing a link that goes nowhere.
 */
function canonicalUrl(raw: string | null): string | null {
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.hostname === 'tendaatacado.com.br') parsed.hostname = SITE_HOST
  return parsed.toString()
}

function firstPhotoUrl(photos: unknown): string | null {
  if (!Array.isArray(photos)) return null
  const first = photos[0]
  return isRecord(first) ? asString(first.url) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Numbers are accepted too: Tenda's `id` is numeric but reads as an id. */
function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

import type { HttpClient } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '@/application/ports/StoreCatalogGateway'

export type SfccStoreConfig = {
  storeId: string
  /** Public storefront host, e.g. "www.nagumo.com.br". */
  host: string
  /** Demandware site id; the controller path is built from it. */
  siteId: string
  /** Storefront locale segment. Every Brazilian site here is pt_BR. */
  locale?: string
  /**
   * The chain's own numeric branch, and the regional lever.
   *
   * Nagumo quotes 49.90 for a 5kg Momiji at branch 25 and 59.90
   * at 7, 46 and 20 around São Paulo. Without it the catalogue answers for
   * whichever branch Demandware defaults to, which is nobody's region.
   */
  sfccStoreId: string
  /** How many products to ask for per term. */
  pageSize?: number
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

const DEFAULT_LOCALE = 'pt_BR'
const DEFAULT_PAGE_SIZE = 24
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Identifying ourselves honestly. A catalogue endpoint that wants to refuse
 * this traffic should be able to see who it is and do so.
 */
const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Reads a Salesforce Commerce Cloud storefront catalogue.
 *
 * A fifth platform. The giveaway was in the response headers rather than
 * the HTML, which carries no platform marker at all: `x-dw-request-base-id`
 * and the `dwsid` / `dwanonymous_` / `dwac_` cookies are Demandware's, and
 * the site id falls out of the page as `Sites-Nagumo-Site`.
 *
 * It is read through `Search-UpdateGrid`, the controller the storefront's
 * own grid calls. That matters for politeness as much as for parsing: the
 * rendered search page is 446KB of HTML with the products buried in
 * escaped JSON, while this answers the same query as 109KB of clean JSON.
 *
 * The awkward part is the branch. Demandware keeps the selected store in
 * server-side session state, so a search has to be made inside a session
 * that has already chosen one — replaying the `dw_store` cookie on its own
 * was measured returning the default branch's 59.90 for a product the
 * chosen branch sells at 49.90. So each run opens one session, and every
 * term after that rides it.
 */
export class SfccCatalogGateway implements StoreCatalogGateway {
  // Negative infinity, not zero: the first request to a store has nothing to
  // wait for, and starting at zero made it sit out a full interval.
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  /** The session that has this branch selected; see `openStoreSession`. */
  private cookie: string | null = null

  constructor(
    private readonly config: SfccStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: one request per term, plus one to open the session on the
   * first call of a run. O(n) over the products returned.
   */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    return this.grid({ q: term }, 0, term)
  }

  /**
   * One window of a category, through the same controller and the same
   * branch session as a keyword search.
   *
   * `cgid` takes the LAST segment of a category path — `cgid=commodities`
   * answers with 1,951 products where the full path answers with none.
   *
   * Complexity: one request; O(n) over the products returned.
   */
  async searchCategory(cgid: string, start: number): Promise<CatalogSearchResult> {
    return this.grid({ cgid }, start, cgid)
  }

  /**
   * The shared request. Keyword and category differ by one parameter and
   * return the same payload, so the session, the pacing and the mapping are
   * stated once.
   */
  private async grid(
    selector: Record<string, string>,
    start: number,
    asked: string,
  ): Promise<CatalogSearchResult> {
    const cookie = await this.openStoreSession()
    if (!cookie) return { status: 'unavailable', reason: 'no-store-session' }

    await this.pace()

    const params = new URLSearchParams({
      ...selector,
      start: String(start),
      sz: String(this.config.pageSize ?? DEFAULT_PAGE_SIZE),
    })

    const response = await this.http.getJson(`${this.controllerBase}/Search-UpdateGrid?${params}`, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Cookie: cookie },
    })

    if (response.status !== 'ok') {
      this.logger.warn('sfcc.search_failed', {
        storeId: this.storeId,
        term: asked,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    const rows = (response.body as { productsSearchResult?: unknown } | null)?.productsSearchResult

    // A term that matches nothing still answers 200 with an empty array, so
    // only a missing or non-array result means the shape changed.
    if (!Array.isArray(rows)) {
      this.logger.warn('sfcc.unexpected_payload', { storeId: this.storeId, term: asked })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = rows.flatMap((raw) => {
      const mapped = toCatalogProduct(raw)
      return mapped ? [mapped] : []
    })

    this.logger.debug('sfcc.search_ok', {
      storeId: this.storeId,
      term: asked,
      received: rows.length,
      usable: products.length,
    })

    return { status: 'ok', products, received: rows.length }
  }

  /**
   * Opens one session with this branch selected and keeps its cookie.
   *
   * Returns null rather than falling back to an anonymous search: a search
   * without a branch answers for Demandware's default, and recording those
   * numbers under a regional label is precisely the bug this collector has
   * already shipped once.
   *
   * Complexity: one request on the first call, O(1) after.
   */
  private async openStoreSession(): Promise<string | null> {
    if (this.cookie) return this.cookie

    await this.pace()

    const response = await this.http.getJson(
      `${this.controllerBase}/Stores-SelectStore?storeId=${encodeURIComponent(this.config.sfccStoreId)}`,
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      },
    )

    const session = response.status === 'ok' ? readSessionId(response.headers['set-cookie']) : null

    if (!session) {
      this.logger.warn('sfcc.store_session_failed', {
        storeId: this.storeId,
        sfccStoreId: this.config.sfccStoreId,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return null
    }

    // dw_store rides along because the storefront sends it; the session id
    // is what actually carries the branch.
    this.cookie = `dwsid=${session}; dw_store=${this.config.sfccStoreId}`
    return this.cookie
  }

  /** Where every storefront controller lives on a Demandware site. */
  private get controllerBase(): string {
    const locale = this.config.locale ?? DEFAULT_LOCALE
    return `https://${this.config.host}/on/demandware.store/Sites-${this.config.siteId}-Site/${locale}`
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

/**
 * The Demandware session id out of a Set-Cookie header.
 *
 * Demandware answers ten Set-Cookie headers at once and the HTTP port folds
 * them into a single comma-joined string, so this picks one out rather than
 * parsing a list. The value is base64 and ends in "==", which is why the
 * terminator set has to stop at `;` and `,` but not at `=`.
 *
 * Complexity: O(n) in the header length.
 */
function readSessionId(setCookie: string | undefined): string | null {
  const match = /(?:^|[,;\s])dwsid=([^;,\s]+)/.exec(setCookie ?? '')
  return match?.[1] ?? null
}

/**
 * Maps one grid row, or returns null when it cannot be priced or linked.
 *
 * Complexity: O(1).
 */
function toCatalogProduct(raw: unknown): CatalogProduct | null {
  if (!isRecord(raw)) return null

  const name = asString(raw.productName)
  const id = asString(raw.id)
  const url = asString(raw.productShowFullUrl)
  if (!name || !id || !url) return null

  const price = asNumber(readPath(raw, 'price', 'sales', 'value'))
  if (price === null || price <= 0) return null

  const listPrice = asNumber(readPath(raw, 'price', 'list', 'value'))

  return {
    externalId: id,
    // No barcode anywhere on the row: customAttributes comes back empty and
    // datasheet null. So Nagumo's products stay store-local unless the
    // approximate matcher pairs them up, exactly as GPA's do.
    ean: null,
    name,
    // shortDescription and longDescription are both empty objects on every
    // row; the blurb only exists on the product page.
    description: null,
    brand: asString(raw.brand),
    imageUrl: firstImageUrl(raw.images),
    url,
    priceReais: price,
    // Only a list price above the selling price is a promotion. None was
    // observed in the wild — `list` was null on every row read — but the
    // field exists and costs nothing to honour.
    listPriceReais: listPrice !== null && listPrice > price ? listPrice : null,
    // The flag, not the count behind it: three Momiji lines carried a
    // non-zero ATSInCurrentStore in the second region and the shop's own page showed
    // all three as "Produto Indisponível".
    inStock: raw.available !== false,
  }
}

/**
 * The asset URL itself rather than the rewriter in front of it.
 *
 * SFCC's `absURL` wraps the real blob URL inside a /on/demandware.static/
 * path, so storing it would give every image a redirect and three times
 * the length. `src.disUrl` is the asset.
 *
 * Complexity: O(1).
 */
function firstImageUrl(images: unknown): string | null {
  if (!isRecord(images)) return null

  const medium = images.medium
  const first = Array.isArray(medium) ? medium[0] : undefined
  if (!isRecord(first)) return null

  const direct = isRecord(first.src) ? asString(first.src.disUrl) : null
  return direct ?? asString(first.absURL)
}

/** Walks a nested path, returning undefined the moment it leaves an object. */
function readPath(source: Record<string, unknown>, ...keys: readonly string[]): unknown {
  let current: unknown = source
  for (const key of keys) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Numbers are accepted too: an SFCC product id reads as an id either way. */
function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

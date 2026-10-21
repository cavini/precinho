import type { HttpClient, HttpJsonResponse } from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
  StoreRegionResolver,
} from '@/application/ports/StoreCatalogGateway'
import type { PostalCode } from '@/domain/value-objects/PostalCode'

export type VipCommerceStoreConfig = {
  storeId: string
  /**
   * The shared platform host. Overridable so a test can aim elsewhere, but
   * every tenant answers on the same one — see the class note.
   */
  apiHost?: string
  /** Tenant on the shared platform. Shibata is 161. */
  organizationId: string
  /** The chain within the tenant ("filial"). Shibata runs a single one, 1. */
  branchId: string
  /**
   * The branch whose shelf is being read ("centro de distribuição").
   *
   * This is the regional lever, and the only one: the second region is centre 10 and
   * A neighbouring one is 11, and the two return different
   * assortments. A sweep
   * without it reads whichever centre the storefront happens to default to.
   */
  distributionCenterId: string
  /** Tenant key the shared API demands alongside the organisation id. */
  domainKey: string
  /** Public domain to build product links on. */
  storefrontHost: string
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

const DEFAULT_API_HOST = 'services.vipcommerce.com.br'
const DEFAULT_PAGE_SIZE = 24
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Where VipCommerce serves product photographs. The catalogue returns a
 * bare filename, so the bucket and a size have to be put back on.
 */
const IMAGE_BASE = 'https://produto-assets-vipcommerce-com-br.br-se1.magaluobjects.com/250x250'

/**
 * The anonymous storefront credentials, read out of the public Angular
 * bundle every visitor downloads. They authenticate the shop, not a person:
 * the token they mint carries `vipcommerceClienteId: null` and reads the
 * same public catalogue the site shows a logged-out browser.
 */
const STOREFRONT_USER = 'loja'
const STOREFRONT_KEY = 'df072f85df9bf7dd71b6811c34bdbaa4f219d98775b56cff9dfa5f8ca1bf8469'

/**
 * Identifying ourselves honestly. A catalogue endpoint that wants to refuse
 * this traffic should be able to see who it is and do so.
 */
const USER_AGENT = 'precinho-collector/1.0 (+https://github.com/cavini/precinho)'

/**
 * Reads a VipCommerce storefront catalogue.
 *
 * VipCommerce is a multi-tenant platform rather than one chain's software:
 * every shop on it answers on the same `services.vipcommerce.com.br` host
 * and is told apart by an organisation id and a domain key. So this adapter
 * is worth more than the one chain that prompted it — adding another
 * VipCommerce grocer is a store row, which is the whole point of keeping
 * the gateway an interface.
 *
 * Two things about it are unlike the other platforms here. It needs a
 * bearer token before it will answer at all, minted from credentials the
 * storefront publishes in its own JavaScript. And the regional lever is a
 * distribution centre in the *path* rather than a parameter, which is the
 * happier arrangement: a wrong centre gives a different assortment rather
 * than quietly giving the default one's prices, which is how the VTEX
 * gateway spent weeks storing Carrefour's national price list.
 *
 * Checked rather than assumed, on 2026-10-19: centre 10 and
 * centre 11 return different assortments for "arroz", and
 * switching the shop's own storefront to the second
 * region's branch reproduced centre 10's list exactly, down to a 4.49
 * rice that only it stocks. The prices themselves match between the two centres — Shibata
 * prices its Vale do Paraíba branches alike — but that is the chain's
 * pricing, confirmed against its own screen, not a parameter being ignored.
 */
export class VipCommerceCatalogGateway implements StoreCatalogGateway, StoreRegionResolver {
  // Negative infinity, not zero: the first request to a store has nothing to
  // wait for, and starting at zero made it sit out a full interval.
  private lastRequestAtMs = Number.NEGATIVE_INFINITY

  /** Minted once per run; see `authorize`. */
  private token: string | null = null

  constructor(
    private readonly config: VipCommerceStoreConfig,
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  get storeId(): string {
    return this.config.storeId
  }

  /**
   * Complexity: one request per term, plus one for the token on the first
   * call of a run. O(n) over the products returned.
   */
  async searchTerm(term: string): Promise<CatalogSearchResult> {
    const headers = await this.authorize()
    if (!headers) return { status: 'unavailable', reason: 'unauthenticated' }

    await this.pace()

    const pageSize = this.config.pageSize ?? DEFAULT_PAGE_SIZE
    const url =
      `${this.branchBase}/buscas/produtos/termo/${encodeTerm(term)}` + `?page=1&limit=${pageSize}`

    return this.toSearchResult(
      await this.http.getJson(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers }),
      term,
    )
  }

  /**
   * One page of a department, mapped exactly like a keyword search — the
   * payloads are identical, which is why browsing needs no second parser.
   *
   * Complexity: one request, O(n) over the products returned.
   */
  async searchDepartment(
    departmentId: string,
    page: number,
    pageSize: number,
  ): Promise<CatalogSearchResult> {
    const headers = await this.authorize()
    if (!headers) return { status: 'unavailable', reason: 'unauthenticated' }

    await this.pace()

    const url =
      `${this.branchBase}/classificacoes_mercadologicas/departamentos/${departmentId}/produtos` +
      `?page=${page}&limit=${pageSize}`

    return this.toSearchResult(
      await this.http.getJson(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers }),
      departmentId,
    )
  }

  /**
   * Exact size of a department, for one request that transfers one product.
   *
   * The category tree publishes `total_ofertas` on every node, which looks
   * like the count a sweep needs and is not: Bebidas reports 204 there
   * against 2,771 products on the paginator. It counts what is on special
   * offer. Planning from it would have swept a fourteenth of the shop and
   * looked like it worked.
   *
   * Complexity: one request; O(1) parsing.
   */
  async countDepartment(departmentId: string): Promise<number | null> {
    const paginator = await this.searchDepartmentPaginator(departmentId)
    const total = paginator?.total_items

    // Checked rather than cast. A count that arrived as a string would
    // divide into NaN when the sweep works out how many pages to ask for,
    // and a slice that stops after one page looks exactly like a small
    // department.
    return typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : null
  }

  /**
   * The shop's own department tree, or null when it cannot be read.
   *
   * Returned raw rather than mapped: the browser is the only caller and it
   * is the one that knows which of the node's fields can be trusted.
   *
   * Complexity: one request.
   */
  async fetchDepartmentTree(): Promise<unknown | null> {
    const headers = await this.authorize()
    if (!headers) return null

    await this.pace()

    const response = await this.http.getJson(
      `${this.branchBase}/classificacoes_mercadologicas/departamentos/arvore`,
      { timeoutMs: REQUEST_TIMEOUT_MS, headers },
    )

    if (response.status !== 'ok') {
      this.logger.warn('vipcommerce.category_tree_failed', {
        storeId: this.storeId,
        result: response.status,
      })
      return null
    }

    return (response.body as { data?: unknown } | null)?.data ?? null
  }

  /** The paginator block, or null when the department cannot be read. */
  private async searchDepartmentPaginator(
    departmentId: string,
  ): Promise<{ total_items?: unknown } | null> {
    const headers = await this.authorize()
    if (!headers) return null

    await this.pace()

    const url =
      `${this.branchBase}/classificacoes_mercadologicas/departamentos/${departmentId}/produtos` +
      `?page=1&limit=1`

    const response = await this.http.getJson(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers })
    if (response.status !== 'ok') return null

    const paginator = (response.body as { paginator?: unknown } | null)?.paginator
    return isRecord(paginator) ? (paginator as { total_items?: number }) : null
  }

  /**
   * Asks the chain which of its branches serves a CEP.
   *
   * Unlike a VTEX account, which hands back a region id for almost any
   * address, this answers an empty list where the chain does not deliver —
   * São Paulo capital and the Rio Branco control both come back empty while
   * the second region names branch 10. That is what makes a positive answer mean
   * something.
   *
   * Complexity: one request; O(1) parsing.
   */
  async resolveRegion(
    postalCode: PostalCode,
  ): Promise<{ regionToken: string; sellerIds: readonly string[] } | null> {
    const headers = await this.authorize()
    if (!headers) return null

    await this.pace()

    const url =
      `${this.organizationBase}/filial/${this.config.branchId}` +
      `/loja/centros_distribuicoes/cep/${postalCode.digits}/entrega`

    const response = await this.http.getJson(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers })
    if (response.status !== 'ok') {
      this.logger.warn('vipcommerce.region_unresolved', {
        storeId: this.storeId,
        result: response.status,
      })
      return null
    }

    const centres = (response.body as { data?: unknown } | null)?.data
    const first = Array.isArray(centres) ? centres[0] : undefined
    if (!isRecord(first)) return null

    const id = asString(first.id)
    if (!id) return null

    // There is one seller: the branch itself. Reported in the same shape as
    // VTEX's so the probe script can compare chains without special cases.
    return { regionToken: id, sellerIds: [id] }
  }

  /**
   * Maps a catalogue response, whatever asked for it.
   *
   * Keyword search and department browsing return the same envelope, so
   * they share this — the only difference between them is the path.
   *
   * Complexity: O(n) over the products returned.
   */
  private toSearchResult(response: HttpJsonResponse, asked: string): CatalogSearchResult {
    if (response.status !== 'ok') {
      this.logger.warn('vipcommerce.search_failed', {
        storeId: this.storeId,
        term: asked,
        result: response.status,
        statusCode: 'statusCode' in response ? response.statusCode : null,
      })
      return { status: 'unavailable', reason: response.status }
    }

    const raws = readProducts(response.body)
    if (raws === null) {
      this.logger.warn('vipcommerce.unexpected_payload', { storeId: this.storeId, term: asked })
      return { status: 'unavailable', reason: 'invalid-json' }
    }

    const products = raws.flatMap((raw) => {
      const mapped = this.toCatalogProduct(raw)
      return mapped ? [mapped] : []
    })

    this.logger.debug('vipcommerce.search_ok', {
      storeId: this.storeId,
      term: asked,
      received: raws.length,
      usable: products.length,
    })

    return { status: 'ok', products }
  }

  /**
   * Maps one catalogue row, or returns null when it cannot be priced or
   * linked.
   *
   * Complexity: O(1).
   */
  private toCatalogProduct(raw: unknown): CatalogProduct | null {
    if (!isRecord(raw)) return null

    const name = asString(raw.descricao)
    const id = asString(raw.produto_id)
    const slug = asString(raw.link)
    if (!name || !id || !slug) return null

    const price = asNumber(raw.preco)
    if (price === null || price <= 0) return null

    const image = asString(raw.imagem)

    return {
      externalId: id,
      // A real barcode, which is what lets Shibata's rows merge with
      // another chain's on a verified GTIN. Passed through raw: checking
      // the digit is the domain's job, not ours.
      ean: asString(raw.codigo_barras),
      name,
      // The search rows carry no blurb. The product endpoint has one, but
      // fetching it per row would multiply a sweep by the page size.
      description: null,
      // No brand on the row either — only `marca_id`, an internal number
      // with no name attached, which would be worse than nothing.
      brand: null,
      imageUrl: image ? `${IMAGE_BASE}/${image}` : null,
      url: this.productUrl(id, slug),
      priceReais: price,
      listPriceReais: listPrice(raw, price),
      inStock: raw.disponivel !== false,
    }
  }

  /**
   * The storefront's canonical product route.
   *
   * `/produto/`, not `/produtos/detalhe/`. The older spelling still works
   * but the app's router answers it with `redirectTo: "produto/:id/:slug"`,
   * and the shop's robots.txt files it under "Redirecionamentos e URLs
   * Legadas" — so storing it would give every shopper a redirect and point
   * the catalogue at a path its owner has already marked for retirement.
   * This is the path the storefront's own cards link to.
   *
   * Complexity: O(1).
   */
  private productUrl(id: string, slug: string): string {
    return `https://${this.config.storefrontHost}/produto/${id}/${slug}`
  }

  /**
   * Bearer token for the shared API, minted once and kept for the run.
   *
   * Returns null rather than throwing when the platform will not issue one,
   * so an outage reads as an unavailable store like any other.
   *
   * Complexity: one request on the first call, O(1) after.
   */
  private async authorize(): Promise<Record<string, string> | null> {
    if (!this.token) {
      await this.pace()

      const response = await this.http.postJson(
        `${this.organizationBase}/auth/loja/login`,
        { domain: this.config.domainKey, username: STOREFRONT_USER, key: STOREFRONT_KEY },
        { timeoutMs: REQUEST_TIMEOUT_MS, headers: this.tenantHeaders },
      )

      const token =
        response.status === 'ok'
          ? asString((response.body as { data?: unknown } | null)?.data)
          : null

      if (!token) {
        this.logger.warn('vipcommerce.token_unavailable', {
          storeId: this.storeId,
          result: response.status,
          statusCode: 'statusCode' in response ? response.statusCode : null,
        })
        return null
      }

      this.token = token
    }

    return { ...this.tenantHeaders, Authorization: `Bearer ${this.token}` }
  }

  /** Which tenant is asking. The shared API answers 403 without these. */
  private get tenantHeaders(): Record<string, string> {
    return {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      DomainKey: this.config.domainKey,
      OrganizationId: this.config.organizationId,
    }
  }

  private get organizationBase(): string {
    const host = this.config.apiHost ?? DEFAULT_API_HOST
    return `https://${host}/api-admin/v1/org/${this.config.organizationId}`
  }

  /** Everything a shopper sees hangs off one branch and one centre. */
  private get branchBase(): string {
    return (
      `${this.organizationBase}/filial/${this.config.branchId}` +
      `/centro_distribuicao/${this.config.distributionCenterId}/loja`
    )
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
 * The struck-out original, from the only field that actually carries it.
 *
 * `preco_original` and `exibe_preco_original` sit on every row and stay at
 * 0 and false even on a plainly discounted product; the previous price is
 * inside `oferta.preco_antigo`. Reading the obvious pair would have
 * reported every promotion in the shop as no promotion at all.
 *
 * Complexity: O(1).
 */
function listPrice(raw: Record<string, unknown>, price: number): number | null {
  const offer = raw.oferta
  if (!isRecord(offer)) return null

  const previous = asNumber(offer.preco_antigo)
  // Only a previous price above the selling price is a promotion.
  return previous !== null && previous > price ? previous : null
}

/**
 * The storefront's own escaping, which has to be matched exactly because
 * the term goes in the path rather than the query string: a raw slash or
 * space would address a different endpoint. Their bundle replaces each of
 * `\ / space % ? =` with a plus before sending.
 *
 * Complexity: O(n) in the term length.
 */
function encodeTerm(term: string): string {
  return term.trim().replace(/[\\/\s%?=]/g, '+')
}

/** The product array, or null when the payload is not the shape promised. */
function readProducts(body: unknown): unknown[] | null {
  if (!isRecord(body)) return null

  const data = body.data
  // Keyword search nests the list under `data.produtos`; a department page
  // puts it straight in `data`.
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.produtos)) return data.produtos
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Prices arrive as decimal strings — "23.29" — rather than as numbers. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Numbers are accepted too: `produto_id` is numeric but reads as an id. */
function asString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

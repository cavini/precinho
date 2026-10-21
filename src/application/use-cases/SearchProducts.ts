import type { Offer } from '@/domain/entities/Offer'
import { Money } from '@/domain/value-objects/Money'
import type { Store } from '@/domain/entities/Store'
import { SearchQuery } from '@/domain/value-objects/SearchQuery'
import type { Clock } from '../ports/Clock'
import type { Logger } from '../ports/Logger'
import type { Metrics } from '../ports/Metrics'
import type { ProductRepository, ProductSearchHit } from '../ports/ProductRepository'
import type { RateLimiter } from '../ports/RateLimiter'
import type { StoreRepository } from '../ports/StoreRepository'
import type { StorePrice } from '../views/StorePrice'
import { toStorePrice } from '../views/StorePrice'

export type SearchProductsInput = {
  rawQuery: string
  regionId: string
  /** The stores the shopper picked. Empty is an error, not "all". */
  storeIds: readonly string[]
  limit?: number
  /** How many results to skip, for the infinite scroll. */
  offset?: number
  clientKey: string
}

export type CheapestOfferView = {
  storeId: string
  storeName: string
  priceCents: number
  priceLabel: string
  /** Null when the package size could not be read. */
  unitPriceLabel: string | null
  url: string
}

export type SearchResultItem = {
  productId: string
  name: string
  /** Store blurb, when the catalogue published one. */
  description: string | null
  brand: string | null
  /** Human size label, e.g. "395 g". Null when unknown. */
  size: string | null
  imageUrl: string | null
  /** Null when no picked store has it in stock. */
  cheapest: CheapestOfferView | null
  /**
   * Every store that has it, cheapest first.
   *
   * The listing used to show one price, which is the answer to a question
   * nobody asked: somebody comparing wants to see 5.19 here and 6.49
   * there, because the gap is the point.
   */
  offers: readonly StorePrice[]
  availableStoreCount: number
  /** What switching stores is worth. Null when there is nothing to compare. */
  spread: { amountLabel: string; percent: number } | null
}

export type SearchProductsOutput =
  | {
      status: 'ok'
      items: readonly SearchResultItem[]
      appliedLimit: number
      /** Whether another page is worth asking for. */
      hasMore: boolean
    }
  | { status: 'invalid-query' }
  | { status: 'no-stores-selected' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  /**
   * The read failed. Kept apart from an empty `ok` because the screens
   * say very different things: "não achei nada" is a claim about the
   * catalogue, and this is a claim about us.
   */
  | { status: 'unavailable' }

export type SearchProductsDeps = {
  productRepository: ProductRepository
  storeRepository: StoreRepository
  rateLimiter: RateLimiter
  logger: Logger
  metrics: Metrics
  clock: Clock
}

/**
 * The listing: what a shopper sees after typing a product name.
 *
 * Every price shown is scoped to the region and to the stores they picked —
 * there is no point telling somebody a chain they never visit is cheaper.
 * The cheapest offer is resolved in the query rather than here, because
 * pulling every offer for every result to reduce in memory would move
 * O(products * stores) rows per keystroke.
 */
export class SearchProducts {
  /** Hard ceiling on a page, whatever the caller asks for. */
  static readonly MAX_LIMIT = 50
  static readonly DEFAULT_LIMIT = 24

  /**
   * As deep as the listing pages.
   *
   * Matches the candidate cap in search_products: past it the query has
   * nothing left to return, so a deeper offset is a wasted round trip.
   */
  static readonly MAX_OFFSET = 1_000

  constructor(private readonly deps: SearchProductsDeps) {}

  /**
   * Complexity: O(n) over the page of hits returned, plus O(s) to index the
   * region's stores by id. Store names come from that one map rather than a
   * join per row.
   */
  async execute(input: SearchProductsInput): Promise<SearchProductsOutput> {
    const { rateLimiter, productRepository, logger, metrics, clock } = this.deps

    const allowance = await rateLimiter.consume(`search:${input.clientKey}`)
    if (!allowance.allowed) {
      logger.warn('search.rate_limited', { retryAfterSeconds: allowance.retryAfterSeconds })
      return this.finish({ status: 'rate-limited', retryAfterSeconds: allowance.retryAfterSeconds })
    }

    const query = SearchQuery.tryParse(input.rawQuery)
    if (!query) {
      return this.finish({ status: 'invalid-query' })
    }

    // An empty pick is never read as "every store": somebody who cleared the
    // picker meant to clear it, and guessing would show prices they ruled out.
    if (input.storeIds.length === 0) {
      return this.finish({ status: 'no-stores-selected' })
    }

    const limit = clampLimit(input.limit)
    const offset = clampOffset(input.offset)

    const startedAt = clock.now().getTime()
    const hits = await productRepository.search({
      query,
      regionId: input.regionId,
      storeIds: input.storeIds,
      limit,
      offset,
    })
    metrics.timing('search.query_ms', clock.now().getTime() - startedAt)

    if (hits === null) {
      logger.error('search.unreadable', { query: query.normalized, regionId: input.regionId })
      return this.finish({ status: 'unavailable' })
    }

    const storesById = await this.indexStores(input.regionId)
    const items = hits.map((hit) => toSearchResultItem(hit, storesById))

    if (items.length === 0) {
      // Worth counting on its own: the misses are what say which products to
      // start collecting next.
      metrics.increment('search.empty')
    }

    logger.info('search.completed', {
      query: query.normalized,
      regionId: input.regionId,
      storeCount: input.storeIds.length,
      resultCount: items.length,
    })

    // A full page means there is probably another; one short means the end.
    // Cheaper than counting the whole match set on every keystroke, and the
    // worst case is one empty request at the bottom.
    return this.finish({
      status: 'ok',
      items,
      appliedLimit: limit,
      hasMore: items.length === limit,
    })
  }

  /** One pass over the region's stores; O(s) to build, O(1) per lookup. */
  private async indexStores(regionId: string): Promise<Map<string, Store>> {
    const stores = await this.deps.storeRepository.listByRegion(regionId)
    return new Map(stores.map((store) => [store.id, store]))
  }

  private finish(output: SearchProductsOutput): SearchProductsOutput {
    this.deps.metrics.increment('search.execute', 1, { status: output.status })
    return output
  }
}

function clampLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return SearchProducts.DEFAULT_LIMIT
  }
  return Math.min(Math.floor(requested), SearchProducts.MAX_LIMIT)
}

/**
 * Caps how deep the listing can be paged.
 *
 * The query reads a bounded candidate set, so an offset past it returns
 * nothing anyway; refusing here keeps a hand-typed offset from spending a
 * round trip to find that out.
 */
function clampOffset(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return 0
  return Math.min(Math.floor(requested), SearchProducts.MAX_OFFSET)
}

function toSearchResultItem(
  hit: ProductSearchHit,
  storesById: Map<string, Store>,
): SearchResultItem {
  const { product, cheapestOffer, dearestPriceCents } = hit

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    brand: product.brand,
    size: product.size?.label() ?? null,
    imageUrl: product.imageUrl,
    cheapest: cheapestOffer ? toCheapestView(cheapestOffer, hit, storesById) : null,
    offers: hit.offers.map((offer, index) => toStorePrice(offer, index === 0, storesById)),
    availableStoreCount: hit.availableStoreCount,
    spread: toSpread(cheapestOffer, dearestPriceCents),
  }
}

function toCheapestView(
  offer: Offer,
  hit: ProductSearchHit,
  storesById: Map<string, Store>,
): CheapestOfferView {
  return {
    storeId: offer.storeId,
    // Falls back to the id rather than throwing: a store row removed between
    // a collection run and a search should not take the listing down.
    storeName: storesById.get(offer.storeId)?.name ?? offer.storeId,
    priceCents: offer.price.cents,
    priceLabel: offer.price.format(),
    unitPriceLabel: offer.unitPrice(hit.product.size)?.format() ?? null,
    url: offer.url,
  }
}

function toSpread(
  cheapest: Offer | null,
  dearestCents: number | null,
): { amountLabel: string; percent: number } | null {
  if (!cheapest || dearestCents === null) return null

  const dearest = Money.fromCents(dearestCents)
  const amount = dearest.minus(cheapest.price)
  if (amount.cents === 0) return null

  return { amountLabel: amount.format(), percent: (amount.cents / dearest.cents) * 100 }
}

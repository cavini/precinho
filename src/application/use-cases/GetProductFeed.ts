import type { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import type { Store } from '@/domain/entities/Store'
import { Money } from '@/domain/value-objects/Money'
import type { StorePrice } from '../views/StorePrice'
import { toStorePrice } from '../views/StorePrice'
import type { Logger } from '../ports/Logger'
import type { Metrics } from '../ports/Metrics'
import type { ProductFeedEntry, ProductRepository } from '../ports/ProductRepository'
import type { RateLimiter } from '../ports/RateLimiter'
import type { StoreRepository } from '../ports/StoreRepository'

export type GetProductFeedInput = {
  regionId: string
  storeIds: readonly string[]
  limit?: number
  /** Cards already shown. The caller counts; the feed's order is stable. */
  offset?: number
  clientKey: string
}

/** Kept as a name the screens already import; the shape is shared. */
export type FeedCardOffer = StorePrice

/** One card: a picture, a name, and the stores that carry it. */
export type FeedCard = {
  productId: string
  name: string
  brand: string | null
  size: string | null
  imageUrl: string | null
  /** Cheapest first; always at least two. */
  offers: readonly FeedCardOffer[]
  /** What switching to the cheapest store is worth. */
  savingsLabel: string
  unitPriceLabel: string | null
}

export type GetProductFeedOutput =
  | {
      status: 'ok'
      cards: readonly FeedCard[]
      /** False once a page comes back short, which is how the scroll stops. */
      hasMore: boolean
    }
  | { status: 'no-stores-selected' }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  /**
   * The read failed. Kept apart from an empty `ok` because the screens
   * say very different things: "nothing here worth comparing" is a claim
   * about the shops, and this is a claim about us.
   */
  | { status: 'unavailable' }

export type GetProductFeedDeps = {
  productRepository: ProductRepository
  storeRepository: StoreRepository
  rateLimiter: RateLimiter
  logger: Logger
  metrics: Metrics
}

/**
 * What the home page shows before anybody searches.
 *
 * A search box on an empty page asks the visitor to already know what they
 * want. The feed answers the question the app exists for without being
 * asked, by leading with the products where switching store saves the most.
 */
export class GetProductFeed {
  static readonly MAX_LIMIT = 24
  static readonly DEFAULT_LIMIT = 12

  constructor(private readonly deps: GetProductFeedDeps) {}

  /**
   * Complexity: O(n * s) over the cards returned and their offers, plus
   * O(s) to index the region's stores by id. The ranking happens in the
   * query, where the whole catalogue is.
   */
  async execute(input: GetProductFeedInput): Promise<GetProductFeedOutput> {
    const { rateLimiter, productRepository, storeRepository, logger } = this.deps

    const allowance = await rateLimiter.consume(`feed:${input.clientKey}`)
    if (!allowance.allowed) {
      return this.finish({ status: 'rate-limited', retryAfterSeconds: allowance.retryAfterSeconds })
    }

    if (input.storeIds.length === 0) {
      return this.finish({ status: 'no-stores-selected' })
    }

    const limit = clamp(input.limit)
    const offset = Math.max(0, Math.floor(input.offset ?? 0))

    const entries = await productRepository.feed({
      regionId: input.regionId,
      storeIds: input.storeIds,
      limit,
      offset,
    })

    if (entries === null) {
      logger.error('feed.unreadable', { regionId: input.regionId, offset })
      return this.finish({ status: 'unavailable' })
    }

    const stores = await storeRepository.listByRegion(input.regionId)
    const storesById = new Map(stores.map((store) => [store.id, store]))

    logger.info('feed.completed', {
      regionId: input.regionId,
      storeCount: input.storeIds.length,
      cardCount: entries.length,
      offset,
    })

    return this.finish({
      status: 'ok',
      cards: entries.map((entry) => toCard(entry, storesById)),
      // A short page means the end; asking again would cost a round trip
      // to learn nothing.
      hasMore: entries.length === limit,
    })
  }

  private finish(output: GetProductFeedOutput): GetProductFeedOutput {
    this.deps.metrics.increment('feed.execute', 1, { status: output.status })
    return output
  }
}

function clamp(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return GetProductFeed.DEFAULT_LIMIT
  }
  return Math.min(Math.floor(requested), GetProductFeed.MAX_LIMIT)
}

function toCard(entry: ProductFeedEntry, storesById: Map<string, Store>): FeedCard {
  const [cheapest] = entry.offers

  return {
    productId: entry.product.id,
    name: entry.product.name,
    brand: entry.product.brand,
    size: entry.product.size?.label() ?? null,
    imageUrl: entry.product.imageUrl,
    offers: entry.offers.map((offer, index) => toStorePrice(offer, index === 0, storesById)),
    savingsLabel: Money.fromCents(entry.spreadCents).format(),
    // On the cheapest offer only: the card is an argument for one price.
    unitPriceLabel: unitPriceOf(cheapest, entry.product),
  }
}

function unitPriceOf(offer: Offer | undefined, product: Product): string | null {
  if (!offer) return null
  return offer.unitPrice(product.size)?.format() ?? null
}

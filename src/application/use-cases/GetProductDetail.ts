import type { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import type { Store } from '@/domain/entities/Store'
import type { OfferComparator } from '@/domain/services/OfferComparator'
import type { Clock } from '../ports/Clock'
import type { Logger } from '../ports/Logger'
import type { Metrics } from '../ports/Metrics'
import type { ProductRepository } from '../ports/ProductRepository'
import type { RateLimiter } from '../ports/RateLimiter'
import type { StoreRepository } from '../ports/StoreRepository'

/**
 * How old a price may be before the screen stops presenting it as current.
 * Two days covers a daily collection run that missed one night.
 */
export const MAX_FRESH_HOURS = 48

export type GetProductDetailInput = {
  productId: string
  regionId: string
  storeIds: readonly string[]
  clientKey: string
}

export type ProductDetailOffer = {
  storeId: string
  storeName: string
  priceCents: number
  priceLabel: string
  unitPriceLabel: string | null
  url: string
  inStock: boolean
  isCheapest: boolean
  /** ISO timestamp, so the view can render it in the reader's locale. */
  collectedAt: string
  isStale: boolean
  /** The store's own promotion against its list price, if any. */
  discount: { amountLabel: string; percent: number } | null
}

export type ProductDetailView = {
  id: string
  name: string
  brand: string | null
  size: string | null
  imageUrl: string | null
  /** Shown so a shopper can confirm it is the same product. */
  ean: string | null
}

export type GetProductDetailOutput =
  | {
      status: 'ok'
      product: ProductDetailView
      /** Cheapest first, out-of-stock last. */
      offers: readonly ProductDetailOffer[]
      cheapestStoreId: string | null
      spread: { amountLabel: string; percent: number } | null
    }
  | { status: 'not-found' }
  | { status: 'no-offers' }
  | { status: 'no-stores-selected' }
  | { status: 'rate-limited'; retryAfterSeconds: number }

export type GetProductDetailDeps = {
  productRepository: ProductRepository
  storeRepository: StoreRepository
  comparator: OfferComparator
  rateLimiter: RateLimiter
  logger: Logger
  metrics: Metrics
  clock: Clock
}

/**
 * The detail screen: every store's price for one product, with the link.
 *
 * Unlike the listing, this does pull every offer and compare in memory —
 * there is one product and a handful of stores, so the cost is trivial and
 * the ranking rules live in one place in the domain instead of being
 * restated in SQL.
 */
export class GetProductDetail {
  constructor(private readonly deps: GetProductDetailDeps) {}

  /**
   * Complexity: O(n log n) in the number of stores holding the product,
   * from the comparator's sort, plus O(s) to index store names.
   */
  async execute(input: GetProductDetailInput): Promise<GetProductDetailOutput> {
    const { rateLimiter, productRepository, storeRepository, comparator } = this.deps
    const { logger, clock } = this.deps

    const allowance = await rateLimiter.consume(`detail:${input.clientKey}`)
    if (!allowance.allowed) {
      return this.finish({ status: 'rate-limited', retryAfterSeconds: allowance.retryAfterSeconds })
    }

    if (input.storeIds.length === 0) {
      return this.finish({ status: 'no-stores-selected' })
    }

    const product = await productRepository.findById(input.productId)
    if (!product) {
      return this.finish({ status: 'not-found' })
    }

    const offers = await productRepository.listOffers(input.productId, input.storeIds)
    if (offers.length === 0) {
      return this.finish({ status: 'no-offers' })
    }

    const comparison = comparator.compare(offers)
    const stores = await storeRepository.listByRegion(input.regionId)
    const storesById = new Map(stores.map((store) => [store.id, store]))
    const now = clock.now()

    logger.info('product_detail.completed', {
      productId: product.id,
      regionId: input.regionId,
      offerCount: comparison.ranked.length,
      cheapestStoreId: comparison.cheapest?.storeId ?? null,
    })

    return this.finish({
      status: 'ok',
      product: toProductView(product),
      offers: comparison.ranked.map((offer) =>
        toOfferView(offer, {
          product,
          storesById,
          now,
          isCheapest: offer === comparison.cheapest,
        }),
      ),
      cheapestStoreId: comparison.cheapest?.storeId ?? null,
      spread: comparison.spread
        ? {
            amountLabel: comparison.spread.amount.format(),
            percent: comparison.spread.percent,
          }
        : null,
    })
  }

  private finish(output: GetProductDetailOutput): GetProductDetailOutput {
    this.deps.metrics.increment('product_detail.execute', 1, { status: output.status })
    return output
  }
}

function toProductView(product: Product): ProductDetailView {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    size: product.size?.label() ?? null,
    imageUrl: product.imageUrl,
    ean: product.ean?.value ?? null,
  }
}

function toOfferView(
  offer: Offer,
  context: {
    product: Product
    storesById: Map<string, Store>
    now: Date
    isCheapest: boolean
  },
): ProductDetailOffer {
  const discount = offer.discount()

  return {
    storeId: offer.storeId,
    storeName: context.storesById.get(offer.storeId)?.name ?? offer.storeId,
    priceCents: offer.price.cents,
    priceLabel: offer.price.format(),
    unitPriceLabel: offer.unitPrice(context.product.size)?.format() ?? null,
    url: offer.url,
    inStock: offer.inStock,
    isCheapest: context.isCheapest,
    collectedAt: offer.collectedAt.toISOString(),
    isStale: offer.isStale(context.now, MAX_FRESH_HOURS),
    discount: discount
      ? { amountLabel: discount.amount.format(), percent: discount.percent }
      : null,
  }
}

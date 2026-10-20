import type { Offer } from '@/domain/entities/Offer'
import { ComparablePrices } from '@/domain/services/ComparablePrices'
import type { Product } from '@/domain/entities/Product'
import type { Region } from '@/domain/entities/Region'
import type { Store } from '@/domain/entities/Store'
import type {
  FeedCriteria,
  ProductFeedEntry,
  ProductRepository,
  ProductSearchHit,
  SearchCriteria,
} from '../ports/ProductRepository'
import type { RegionRepository } from '../ports/RegionRepository'
import type { StoreRepository } from '../ports/StoreRepository'

export class InMemoryRegionRepository implements RegionRepository {
  constructor(private readonly regions: readonly Region[] = []) {}

  async listAll(): Promise<readonly Region[]> {
    return this.regions
  }

  async findBySlug(slug: string): Promise<Region | null> {
    return this.regions.find((region) => region.slug === slug) ?? null
  }
}

export class InMemoryStoreRepository implements StoreRepository {
  constructor(private readonly stores: readonly Store[] = []) {}

  async listByRegion(regionId: string): Promise<readonly Store[]> {
    return this.stores.filter((store) => store.regionId === regionId)
  }
}

/** An offer plus the product it belongs to, which is how rows are stored. */
export type StoredOffer = {
  productId: string
  offer: Offer
}

/**
 * Reference implementation of ProductRepository.
 *
 * This is not a throwaway: the repository contract test runs against this
 * and against the Supabase adapter, so the two cannot drift. The rules it
 * encodes — only the latest offer per store counts, out-of-stock never wins,
 * results are ordered deterministically — are the specification.
 */
export class InMemoryProductRepository implements ProductRepository {
  constructor(
    private readonly products: readonly Product[] = [],
    private readonly offers: readonly StoredOffer[] = [],
    private readonly stores: readonly Store[] = [],
  ) {}

  async search(criteria: SearchCriteria): Promise<readonly ProductSearchHit[]> {
    const storeIds = this.storeIdsInRegion(criteria.regionId, criteria.storeIds)

    const hits = this.products
      .filter((product) =>
        criteria.query.tokens.every((token) => startsAWord(product.searchText, token)),
      )
      .map((product) => this.toHit(product, storeIds))
      .sort(byComparability)

    return hits.slice(criteria.offset, criteria.offset + criteria.limit)
  }

  async feed(criteria: FeedCriteria): Promise<readonly ProductFeedEntry[]> {
    const storeIds = this.storeIdsInRegion(criteria.regionId, criteria.storeIds)

    return (
      this.products
        .map((product) => {
          const offers = this.comparableOffers(product.id, storeIds)

          const spreadCents = offers.length
            ? offers[offers.length - 1].price.cents - offers[0].price.cents
            : 0

          return { product, offers, spreadCents }
        })
        // One price is not a comparison.
        .filter((entry) => entry.offers.length > 1)
        .sort(
          (a, b) =>
            Number(b.product.imageUrl !== null) - Number(a.product.imageUrl !== null) ||
            b.spreadCents - a.spreadCents ||
            b.offers.length - a.offers.length ||
            a.product.id.localeCompare(b.product.id),
        )
        .slice(criteria.offset, criteria.offset + criteria.limit)
    )
  }

  async findById(productId: string): Promise<Product | null> {
    return this.products.find((product) => product.id === productId) ?? null
  }

  async listOffers(productId: string, storeIds: readonly string[]): Promise<readonly Offer[]> {
    return this.currentOffers(productId, new Set(storeIds))
  }

  /** Only stores that are both picked by the shopper and in the region. */
  private storeIdsInRegion(regionId: string, picked: readonly string[]): ReadonlySet<string> {
    const inRegion = new Set(
      this.stores.filter((store) => store.regionId === regionId).map((store) => store.id),
    )
    return new Set(picked.filter((id) => inRegion.has(id)))
  }

  /**
   * Offers are append-only, so a store's current price is its most recent
   * row. Anything older is price history, not a competing offer.
   */
  private currentOffers(productId: string, storeIds: ReadonlySet<string>): Offer[] {
    const latestByStore = new Map<string, Offer>()

    for (const stored of this.offers) {
      if (stored.productId !== productId) continue
      if (!storeIds.has(stored.offer.storeId)) continue

      const existing = latestByStore.get(stored.offer.storeId)
      if (!existing || stored.offer.collectedAt > existing.collectedAt) {
        latestByStore.set(stored.offer.storeId, stored.offer)
      }
    }

    return [...latestByStore.values()]
  }

  /**
   * In-stock offers worth comparing, cheapest first.
   *
   * Applies the same refusal the SQL does: a price more than three times
   * the cheapest is a different package sharing a barcode, not a worse
   * deal. Search offered a Nivea bar at 1.99 against 24.91 and called the
   * gap a 92% saving — the 24.91 is a box.
   *
   * Complexity: O(n log n) for the sort over one product's offers.
   */
  private comparableOffers(productId: string, storeIds: ReadonlySet<string>): Offer[] {
    const available = this.currentOffers(productId, storeIds)
      .filter((offer) => offer.inStock)
      .sort((a, b) => a.price.cents - b.price.cents || a.storeId.localeCompare(b.storeId))

    const kept = new ComparablePrices().keepComparable(available.map((offer) => offer.price))
    const ceiling = kept.length > 0 ? kept[kept.length - 1].cents : 0

    return available.filter((offer) => offer.price.cents <= ceiling)
  }

  private toHit(product: Product, storeIds: ReadonlySet<string>): ProductSearchHit {
    const available = this.comparableOffers(product.id, storeIds)

    return {
      product,
      cheapestOffer: available[0] ?? null,
      // Already cheapest-first, matching the order the SQL aggregates in.
      offers: available,
      dearestPriceCents: available[available.length - 1]?.price.cents ?? null,
      availableStoreCount: available.length,
    }
  }
}

/**
 * Whether the token begins a word in the text.
 *
 * Substring matching made "coca" find "paçoca", which is wrong in a way
 * shoppers notice at once. A word-start anchor keeps prefix matching —
 * "refri" still finds "refrigerante" — while refusing a match that starts
 * mid-word. Mirrors the `\m` anchor the SQL function uses.
 *
 * Complexity: O(n) in the text length.
 */
function startsAWord(text: string, token: string): boolean {
  return new RegExp(`\\b${token}`).test(text)
}

/**
 * Products you can actually buy come first, then by name.
 *
 * Name order rather than a relevance score, because the query already
 * requires every token to match, so everything returned is relevant and a
 * stable order is worth more than a guessed one. Trigram ranking is a later
 * slice, and when it lands it lands in both implementations at once.
 */
/**
 * The same ranking search_products applies, because this repository is the
 * contract in TypeScript and the SQL is the contract in Postgres — a
 * difference between them is a bug in one of the two, which is what the
 * contract test exists to catch.
 *
 * Most shops first, then the widest disagreement, then having a photo,
 * then name. Alphabetical alone put Arroz Arbóreo Riso Scotti — one shop,
 * no comparison — at the top of a search for "arroz".
 */
function byComparability(a: ProductSearchHit, b: ProductSearchHit): number {
  if (a.availableStoreCount !== b.availableStoreCount) {
    return b.availableStoreCount - a.availableStoreCount
  }

  const spread = spreadOf(b) - spreadOf(a)
  if (spread !== 0) return spread

  const aPhoto = a.product.imageUrl !== null
  const bPhoto = b.product.imageUrl !== null
  if (aPhoto !== bPhoto) return aPhoto ? -1 : 1

  return a.product.name.localeCompare(b.product.name) || a.product.id.localeCompare(b.product.id)
}

/** Dearest minus cheapest, or zero when there is nothing to compare. */
function spreadOf(hit: ProductSearchHit): number {
  if (hit.dearestPriceCents === null || !hit.cheapestOffer) return 0
  return hit.dearestPriceCents - hit.cheapestOffer.price.cents
}

import type { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import type { SearchQuery } from '@/domain/value-objects/SearchQuery'

/**
 * One search result: a product with the cheapest price among the stores the
 * shopper picked.
 *
 * The cheapest offer is resolved by the repository rather than by fetching
 * every offer and reducing in memory. For p products across s stores that
 * would move O(p * s) rows per keystroke; letting the query do it with an
 * index on (product, store, collected_at) keeps it to O(p) rows out.
 *
 * The dearest price comes back with it so the spread needs no second trip —
 * only the amount, since nothing links to the most expensive store.
 */
export type ProductSearchHit = {
  product: Product
  /** Null when no store the shopper picked has it in stock. */
  cheapestOffer: Offer | null
  /**
   * Every in-stock offer, cheapest first.
   *
   * The listing shows the stores under the name the way the feed does, so
   * a single price would hide the gap the comparison exists to show.
   */
  offers: readonly Offer[]
  /** Dearest in-stock price in cents; equals the cheapest when one store has it. */
  dearestPriceCents: number | null
  /** How many of the picked stores have it in stock. */
  availableStoreCount: number
}

export type SearchCriteria = {
  query: SearchQuery
  regionId: string
  /** The stores the shopper picked. Never empty — the caller resolves the default. */
  storeIds: readonly string[]
  limit: number
  /** How many results to skip. The ranking is stable, so this is safe. */
  offset: number
}

/**
 * One card on the home feed: a product and every store that has it.
 *
 * Carries all the offers, not just the cheapest, because the card lists the
 * stores underneath the picture.
 */
export type ProductFeedEntry = {
  product: Product
  /** In-stock offers, cheapest first. Never fewer than two. */
  offers: readonly Offer[]
  /** Dearest minus cheapest, which is what the feed is ranked on. */
  spreadCents: number
}

export type FeedCriteria = {
  regionId: string
  storeIds: readonly string[]
  limit: number
  /** How many cards to skip. The feed's order is stable, so this is safe. */
  offset: number
}

export interface ProductRepository {
  /**
   * What to show before anybody searches: products worth switching store
   * for, biggest saving first.
   *
   * Implementations must exclude products carried by fewer than two of the
   * picked stores — a single price is not a comparison — and must leave out
   * out-of-stock offers, as everywhere else.
   */
  feed(criteria: FeedCriteria): Promise<readonly ProductFeedEntry[]>

  /**
   * Products matching every token of the query, ranked by how well they
   * match. Implementations must exclude out-of-stock offers from
   * `cheapestOffer`, which the repository contract test enforces.
   */
  search(criteria: SearchCriteria): Promise<readonly ProductSearchHit[]>

  findById(productId: string): Promise<Product | null>

  /** Every current offer for one product among the given stores. */
  listOffers(productId: string, storeIds: readonly string[]): Promise<readonly Offer[]>
}

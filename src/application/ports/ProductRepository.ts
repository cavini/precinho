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
 * `dearestInStock` comes back with it so the spread can be computed without
 * a second trip.
 */
export type ProductSearchHit = {
  product: Product
  /** Null when no store the shopper picked has it in stock. */
  cheapestOffer: Offer | null
  /** Dearest in-stock offer; equals the cheapest when only one store has it. */
  dearestOffer: Offer | null
  /** How many of the picked stores have it in stock. */
  availableStoreCount: number
}

export type SearchCriteria = {
  query: SearchQuery
  regionId: string
  /** The stores the shopper picked. Never empty — the caller resolves the default. */
  storeIds: readonly string[]
  limit: number
}

export interface ProductRepository {
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

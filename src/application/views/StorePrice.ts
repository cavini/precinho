import type { Offer } from '@/domain/entities/Offer'
import type { Store } from '@/domain/entities/Store'

/**
 * One store's price for one product, ready to render.
 *
 * Shared by the feed and the search listing because they show the same
 * thing: the stores under the product name, cheapest marked. Two copies of
 * this would drift the moment one screen gained a field.
 */
export type StorePrice = {
  storeId: string
  storeName: string
  priceLabel: string
  url: string
  isCheapest: boolean
}

/**
 * Falls back to the store id when a store is missing from the map, so a
 * row that outlived its store still renders a price instead of crashing.
 *
 * Complexity: O(1).
 */
export function toStorePrice(
  offer: Offer,
  isCheapest: boolean,
  storesById: ReadonlyMap<string, Store>,
): StorePrice {
  return {
    storeId: offer.storeId,
    storeName: storesById.get(offer.storeId)?.name ?? offer.storeId,
    priceLabel: offer.price.format(),
    url: offer.url,
    isCheapest,
  }
}

import type { CanonicalUnit } from '@/domain/value-objects/Quantity'

/** A product as the collector wants it stored, keyed by its match key. */
export type ProductUpsert = {
  matchKey: string
  gtin14: string | null
  name: string
  description: string | null
  brand: string | null
  sizeAmount: number | null
  sizeUnit: CanonicalUnit | null
  imageUrl: string | null
  searchText: string
}

export type OfferInsert = {
  productId: string
  storeId: string
  priceCents: number
  listPriceCents: number | null
  url: string
  inStock: boolean
  collectedAt: Date
}

export interface CatalogWriter {
  /**
   * Upserts on match key and returns match key to product id, so the caller
   * can attach offers without a second lookup per product.
   */
  upsertProducts(products: readonly ProductUpsert[]): Promise<ReadonlyMap<string, string>>

  /** Appends offers. Returns how many rows landed. */
  insertOffers(offers: readonly OfferInsert[]): Promise<number>
}

import type { Ean } from '../value-objects/Ean'
import type { Quantity } from '../value-objects/Quantity'

/**
 * A product as the catalogue describes it, independent of any price.
 *
 * `searchText` is stored rather than derived at query time so the index can
 * be built on it; it must be produced by the same normalisation the search
 * uses, or a product can be filed under a key no query can reach.
 */
export type Product = {
  id: string
  /** Null when the store gave no verifiable barcode. */
  ean: Ean | null
  name: string
  brand: string | null
  /** Null when no size could be read from the name. */
  size: Quantity | null
  imageUrl: string | null
  /** Normalised name plus brand; what the search index is built on. */
  searchText: string
  /** Identity used to recognise this product across stores and runs. */
  matchKey: string
}

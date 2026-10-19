import type { PostalCode } from '@/domain/value-objects/PostalCode'

/** One sellable item as a store catalogue reports it, before any validation. */
export type CatalogProduct = {
  /** The store's own id for it, for tracing a row back to its source. */
  externalId: string
  /** Raw barcode as given; the domain decides whether to trust it. */
  ean: string | null
  name: string
  /** Store's own blurb. Null when the catalogue publishes none. */
  description: string | null
  brand: string | null
  imageUrl: string | null
  /** Absolute link to the product page at that store. */
  url: string
  priceReais: number
  listPriceReais: number | null
  inStock: boolean
}

export type CatalogSearchResult =
  | { status: 'ok'; products: readonly CatalogProduct[] }
  /** The store is down, blocking us, or changed its API. */
  | { status: 'unavailable'; reason: string }

/**
 * Reads one store's catalogue.
 *
 * One implementation per platform, not per store: adding a chain that runs
 * on the same platform is a configuration row, not code. That is the point
 * of keeping this an interface.
 */
export interface StoreCatalogGateway {
  readonly storeId: string
  searchTerm(term: string): Promise<CatalogSearchResult>
}

/**
 * Prices on these platforms vary by delivery area, so a collection run has
 * to say where it is shopping from before the prices mean anything.
 */
export interface StoreRegionResolver {
  resolveRegion(
    postalCode: PostalCode,
  ): Promise<{ regionToken: string; sellerIds: readonly string[] } | null>
}

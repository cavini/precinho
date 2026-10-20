import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from '@/application/ports/Logger'
import type {
  FeedCriteria,
  ProductFeedEntry,
  ProductRepository,
  ProductSearchHit,
  SearchCriteria,
} from '@/application/ports/ProductRepository'
import type { Offer } from '@/domain/entities/Offer'
import type { Product } from '@/domain/entities/Product'
import { type OfferRow, toOffer, toProduct } from './mappers'

/** One row of search_products. */
type SearchRow = {
  product_id: string
  name: string
  description: string | null
  brand: string | null
  size_amount: number | string | null
  size_unit: string | null
  image_url: string | null
  gtin14: string | null
  cheapest_store_id: string | null
  cheapest_price_cents: number | null
  cheapest_list_price_cents: number | null
  cheapest_url: string | null
  cheapest_collected_at: string | null
  dearest_price_cents: number | null
  available_store_count: number
  offers: Array<{
    store_id: string
    price_cents: number
    url: string
    collected_at: string
  }> | null
}

/** One row of product_feed. */
type FeedRow = {
  product_id: string
  name: string
  brand: string | null
  size_amount: number | string | null
  size_unit: string | null
  image_url: string | null
  gtin14: string | null
  spread_cents: number
  offers: Array<{
    store_id: string
    price_cents: number
    url: string
    collected_at: string
  }> | null
}

type ProductRow = {
  id: string
  name: string
  description: string | null
  brand: string | null
  size_amount: number | string | null
  size_unit: string | null
  image_url: string | null
  gtin14: string | null
}

/**
 * Reads products and prices through the SQL functions in
 * 0002_search_functions.sql.
 *
 * The functions are the implementation of the ProductRepository contract on
 * this side; the in-memory repository is the same contract in TypeScript, and
 * the contract test is what holds them to each other.
 */
export class SupabaseProductRepository implements ProductRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Complexity: one round trip. The work inside is bounded by the function's
   * own candidate cap, so a broad query cannot turn into a catalogue scan.
   */
  async search(criteria: SearchCriteria): Promise<readonly ProductSearchHit[]> {
    const { data, error } = await this.client.rpc('search_products', {
      p_tokens: criteria.query.tokens,
      p_region_id: criteria.regionId,
      p_store_ids: criteria.storeIds,
      p_limit: criteria.limit,
    })

    if (error) {
      this.logger.error('products.search_failed', {
        reason: error.message,
        regionId: criteria.regionId,
      })
      return []
    }

    return (data as SearchRow[]).map((row) => this.toHit(row))
  }

  /**
   * Complexity: one round trip. The ranking and the two-store minimum are
   * applied in the query, so what comes back is already the page.
   */
  async feed(criteria: FeedCriteria): Promise<readonly ProductFeedEntry[]> {
    const { data, error } = await this.client.rpc('product_feed', {
      p_region_id: criteria.regionId,
      p_store_ids: criteria.storeIds,
      p_limit: criteria.limit,
      p_offset: criteria.offset,
    })

    if (error) {
      this.logger.error('products.feed_failed', {
        reason: error.message,
        regionId: criteria.regionId,
      })
      return []
    }

    return (data as FeedRow[]).flatMap((row) => {
      const offers = (row.offers ?? []).flatMap((offer) => {
        const mapped = toOffer({
          store_id: offer.store_id,
          price_cents: offer.price_cents,
          list_price_cents: null,
          url: offer.url,
          // The function only aggregates in-stock offers.
          in_stock: true,
          collected_at: offer.collected_at,
        })
        return mapped ? [mapped] : []
      })

      // A row that lost an offer to bad data may no longer be a comparison.
      if (offers.length < 2) return []

      return [{ product: toProduct(row), offers, spreadCents: row.spread_cents }]
    })
  }

  async findById(productId: string): Promise<Product | null> {
    const { data, error } = await this.client
      .from('products')
      .select('id, name, description, brand, size_amount, size_unit, image_url, gtin14')
      .eq('id', productId)
      .maybeSingle()

    if (error) {
      this.logger.error('products.find_failed', { productId, reason: error.message })
      return null
    }
    if (!data) return null

    const row = data as ProductRow
    return toProduct({ ...row, product_id: row.id })
  }

  /** Complexity: one round trip, O(stores) index lookups inside. */
  async listOffers(productId: string, storeIds: readonly string[]): Promise<readonly Offer[]> {
    const { data, error } = await this.client.rpc('product_offers', {
      p_product_id: productId,
      p_store_ids: storeIds,
    })

    if (error) {
      this.logger.error('offers.list_failed', { productId, reason: error.message })
      return []
    }

    return this.toOffers(data as OfferRow[], productId)
  }

  private toHit(row: SearchRow): ProductSearchHit {
    return {
      product: toProduct(row),
      cheapestOffer: this.toCheapestOffer(row),
      offers: (row.offers ?? []).flatMap((offer) => {
        const mapped = toOffer({
          store_id: offer.store_id,
          price_cents: offer.price_cents,
          list_price_cents: null,
          url: offer.url,
          // The function only aggregates in-stock offers.
          in_stock: true,
          collected_at: offer.collected_at,
        })
        return mapped ? [mapped] : []
      }),
      dearestPriceCents: row.dearest_price_cents,
      availableStoreCount: row.available_store_count,
    }
  }

  private toCheapestOffer(row: SearchRow): Offer | null {
    if (
      row.cheapest_store_id === null ||
      row.cheapest_price_cents === null ||
      row.cheapest_url === null ||
      row.cheapest_collected_at === null
    ) {
      return null
    }

    const offer = toOffer({
      store_id: row.cheapest_store_id,
      price_cents: row.cheapest_price_cents,
      list_price_cents: row.cheapest_list_price_cents,
      url: row.cheapest_url,
      // The function only selects in-stock offers for this column.
      in_stock: true,
      collected_at: row.cheapest_collected_at,
    })

    if (!offer) {
      this.logger.warn('offers.row_unusable', { productId: row.product_id })
    }
    return offer
  }

  /** Drops unusable rows rather than failing the page over one of them. */
  private toOffers(rows: readonly OfferRow[], productId: string): readonly Offer[] {
    const offers: Offer[] = []
    let dropped = 0

    for (const row of rows) {
      const offer = toOffer(row)
      if (offer) offers.push(offer)
      else dropped += 1
    }

    if (dropped > 0) {
      this.logger.warn('offers.rows_dropped', { productId, dropped })
    }
    return offers
  }
}

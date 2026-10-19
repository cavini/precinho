import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogWriter, OfferInsert, ProductUpsert } from '@/application/ports/CatalogWriter'
import type { Logger } from '@/application/ports/Logger'

/**
 * How many rows to send at a time.
 *
 * Supabase caps request bodies, and a sweep of several hundred products in
 * one statement is also a single point of failure: one bad row rejects the
 * whole batch. Chunking means a bad row costs its chunk.
 */
const CHUNK_SIZE = 200

/**
 * Writes a collection run.
 *
 * Uses the service role key, so it is the only thing in the codebase that can
 * change a price. Products upsert on match key; offers only ever insert,
 * which is what makes price history free.
 */
export class SupabaseCatalogWriter implements CatalogWriter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Complexity: O(n/CHUNK_SIZE) round trips, O(n) rows. The returned map is
   * built in one pass so the caller does not look products up one by one.
   */
  async upsertProducts(products: readonly ProductUpsert[]): Promise<ReadonlyMap<string, string>> {
    const ids = new Map<string, string>()

    for (const chunk of chunked(products, CHUNK_SIZE)) {
      const { data, error } = await this.client
        .from('products')
        .upsert(
          chunk.map((product) => ({
            match_key: product.matchKey,
            gtin14: product.gtin14,
            name: product.name,
            brand: product.brand,
            size_amount: product.sizeAmount,
            size_unit: product.sizeUnit,
            image_url: product.imageUrl,
            search_text: product.searchText,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'match_key' },
        )
        .select('id, match_key')

      if (error) {
        // The chunk is lost, the run is not. Its products simply get no new
        // price this time, and the next run picks them up.
        this.logger.error('collector.product_upsert_failed', {
          rows: chunk.length,
          reason: error.message,
        })
        continue
      }

      for (const row of data as Array<{ id: string; match_key: string }>) {
        ids.set(row.match_key, row.id)
      }
    }

    return ids
  }

  /** Complexity: O(n/CHUNK_SIZE) round trips. */
  async insertOffers(offers: readonly OfferInsert[]): Promise<number> {
    let written = 0

    for (const chunk of chunked(offers, CHUNK_SIZE)) {
      const { error, count } = await this.client.from('offers').insert(
        chunk.map((offer) => ({
          product_id: offer.productId,
          store_id: offer.storeId,
          price_cents: offer.priceCents,
          list_price_cents: offer.listPriceCents,
          url: offer.url,
          in_stock: offer.inStock,
          collected_at: offer.collectedAt.toISOString(),
        })),
        { count: 'exact' },
      )

      if (error) {
        this.logger.error('collector.offer_insert_failed', {
          rows: chunk.length,
          reason: error.message,
        })
        continue
      }

      written += count ?? chunk.length
    }

    return written
  }
}

function* chunked<T>(items: readonly T[], size: number): Generator<readonly T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size)
  }
}

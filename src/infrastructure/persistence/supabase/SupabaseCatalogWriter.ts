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
 * How many values go into one lookup.
 *
 * These travel in a request body now rather than a query string, so
 * length is no longer the constraint it was — a URL carrying two hundred
 * product names was long enough that fetch refused to send it. The number
 * is about keeping one failed call cheap.
 */
const LOOKUP_SIZE = 500

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
    let matched = 0

    // Two ways a product already here can be recognised. The name is the
    // durable one — a shop republishes the same string every sweep —
    // while the key is derived and has already changed shape once, when
    // barcode-less products stopped being keyed per store.
    const [absorbed, byName] = await Promise.all([
      this.resolveAliases(products.map((product) => product.matchKey)),
      this.resolveNames(products.map((product) => product.name)),
    ])

    for (const chunk of chunked(products, CHUNK_SIZE)) {
      // A product that was folded into another keeps attaching its offers
      // there. Without this the shop that produced the old key recreates
      // the row the merge removed, and a day's judging is undone by the
      // next sweep.
      const fresh: ProductUpsert[] = []
      for (const product of chunk) {
        const known = absorbed.get(product.matchKey) ?? byName.get(product.name)
        if (known) {
          ids.set(product.matchKey, known)
          matched += 1
        } else {
          fresh.push(product)
        }
      }

      if (fresh.length === 0) continue

      const { data, error } = await this.client
        .from('products')
        .upsert(
          fresh.map((product) => ({
            match_key: product.matchKey,
            gtin14: product.gtin14,
            name: product.name,
            description: product.description,
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
          rows: fresh.length,
          reason: error.message,
        })
        continue
      }

      for (const row of data as Array<{ id: string; match_key: string }>) {
        ids.set(row.match_key, row.id)
      }
    }

    // The number that says how much reconciling tomorrow will cost. A
    // sweep that recognises everything it sees creates no new pairs to
    // judge; one that creates hundreds of rows creates work. Without it
    // the only way to know was to count the catalogue before and after.
    this.logger.info('collector.products_written', {
      seen: products.length,
      matched,
      created: products.length - matched,
    })

    return ids
  }

  /**
   * Keys that belong to a product folded into another, and where they now
   * point.
   *
   * Read once per run rather than per chunk: a sweep writes thousands of
   * products and the alias set is the same throughout.
   *
   * Complexity: O(n/CHUNK_SIZE) round trips, O(n) in the keys asked about.
   */
  private async resolveAliases(keys: readonly string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>()

    for (const chunk of chunked([...new Set(keys)], LOOKUP_SIZE)) {
      const { data, error } = await this.client.rpc('resolve_product_aliases', {
        p_keys: chunk,
      })

      if (error) {
        // Loud, because failing open here recreates rows a merge removed
        // and the run still reports success. That happened once, and the
        // only trace was a warning nobody read.
        this.logger.error('collector.aliases_unreadable', { reason: error.message })
        return resolved
      }

      for (const row of (data ?? []) as Array<{ match_key: string; product_id: string }>) {
        resolved.set(row.match_key, row.product_id)
      }
    }

    return resolved
  }

  /**
   * Names already known to belong to a product.
   *
   * Exact rather than fuzzy on purpose: a second notion of "the same
   * name" living in the database would drift from the one in the domain
   * the first time either changed, and the shops republish their strings
   * unchanged anyway.
   *
   * Complexity: O(n/LOOKUP_SIZE) round trips, O(n) in the names asked about.
   */
  private async resolveNames(names: readonly string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>()

    for (const chunk of chunked([...new Set(names)], LOOKUP_SIZE)) {
      const { data, error } = await this.client.rpc('resolve_product_names', {
        p_names: chunk,
      })

      if (error) {
        this.logger.error('collector.names_unreadable', { reason: error.message })
        return resolved
      }

      for (const row of (data ?? []) as Array<{ name: string; product_id: string }>) {
        resolved.set(row.name, row.product_id)
      }
    }

    return resolved
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

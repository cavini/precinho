import type { ProductMatcher } from '@/domain/services/ProductMatcher'
import type { ProductNameParser } from '@/domain/services/ProductNameParser'
import { Ean } from '@/domain/value-objects/Ean'
import { Money } from '@/domain/value-objects/Money'
import type { CatalogProduct } from '@/application/ports/StoreCatalogGateway'
import type { CatalogWriter, OfferInsert, ProductUpsert } from '../ports/CatalogWriter'
import type { Clock } from '../ports/Clock'
import type { Logger } from '../ports/Logger'
import type { Metrics } from '../ports/Metrics'
import type { StoreCatalogGateway } from '../ports/StoreCatalogGateway'

export type CollectStoreOffersInput = {
  /** Search terms to sweep, e.g. a basic-basket list. */
  terms: readonly string[]
}

export type CollectionReport = {
  storeId: string
  termsAttempted: number
  /** Terms where the store would not answer. A run is usually partly failed. */
  termsFailed: number
  productsSeen: number
  productsStored: number
  offersWritten: number
  /** Why rows were discarded, so a bad run can be explained afterwards. */
  discarded: { unpriceable: number; unusableEan: number }
}

export type CollectStoreOffersDeps = {
  gateway: StoreCatalogGateway
  writer: CatalogWriter
  nameParser: ProductNameParser
  matcher: ProductMatcher
  logger: Logger
  metrics: Metrics
  clock: Clock
}

/**
 * Sweeps one store's catalogue for a list of terms and records what it finds.
 *
 * A run is expected to be partly broken — stores rate-limit, change their
 * API, or go down mid-sweep — so a failed term is counted and the sweep
 * carries on. Returning a report rather than throwing is what makes "we
 * collected four of five stores last night" a visible fact instead of a
 * silent gap in the data.
 */
export class CollectStoreOffers {
  constructor(private readonly deps: CollectStoreOffersDeps) {}

  /**
   * Complexity: O(t) requests for t terms, then O(n) over the products found.
   * Products are deduplicated through a hash keyed on match key, so
   * recognising a product already seen in this run is O(1) rather than a scan
   * of everything seen so far.
   */
  async execute(input: CollectStoreOffersInput): Promise<CollectionReport> {
    const { gateway, writer, logger, metrics, clock } = this.deps
    const runLogger = logger.child({ storeId: gateway.storeId })
    const startedAt = clock.now().getTime()

    const report: CollectionReport = {
      storeId: gateway.storeId,
      termsAttempted: input.terms.length,
      termsFailed: 0,
      productsSeen: 0,
      productsStored: 0,
      offersWritten: 0,
      discarded: { unpriceable: 0, unusableEan: 0 },
    }

    // Keyed by match key so the same product found under two terms is stored
    // once. O(1) per lookup.
    const products = new Map<string, ProductUpsert>()
    const pending: Array<{ matchKey: string; product: CatalogProduct }> = []

    for (const term of input.terms) {
      const result = await gateway.searchTerm(term)

      if (result.status !== 'ok') {
        report.termsFailed += 1
        metrics.increment('collector.term_failed', 1, { storeId: gateway.storeId })
        continue
      }

      for (const found of result.products) {
        report.productsSeen += 1

        const upsert = this.toUpsert(found, report)
        if (!upsert) continue

        if (!products.has(upsert.matchKey)) products.set(upsert.matchKey, upsert)
        pending.push({ matchKey: upsert.matchKey, product: found })
      }
    }

    const ids = await writer.upsertProducts([...products.values()])
    report.productsStored = ids.size

    const offers = this.toOffers(pending, ids, clock.now())
    report.offersWritten = offers.length > 0 ? await writer.insertOffers(offers) : 0

    metrics.timing('collector.store_ms', clock.now().getTime() - startedAt, {
      storeId: gateway.storeId,
    })
    metrics.increment('collector.offers_written', report.offersWritten, {
      storeId: gateway.storeId,
    })
    // Flattened on purpose: a nested object in a log line is not queryable.
    runLogger.info('collector.store_finished', {
      termsAttempted: report.termsAttempted,
      termsFailed: report.termsFailed,
      productsSeen: report.productsSeen,
      productsStored: report.productsStored,
      offersWritten: report.offersWritten,
      discardedUnpriceable: report.discarded.unpriceable,
      discardedUnusableEan: report.discarded.unusableEan,
    })

    return report
  }

  /** Null when the row cannot be stored; the reason is counted in the report. */
  private toUpsert(found: CatalogProduct, report: CollectionReport): ProductUpsert | null {
    const { nameParser, matcher } = this.deps

    if (!Number.isFinite(found.priceReais) || found.priceReais <= 0 || !found.name) {
      report.discarded.unpriceable += 1
      return null
    }

    const ean = Ean.tryParse(found.ean)
    // Not a discard: the product is still stored, just not merged across
    // stores. Counted so I can see how much of the catalogue cannot be compared.
    if (found.ean && !ean) report.discarded.unusableEan += 1

    const size = nameParser.extractSize(found.name)
    const brand = nameParser.normalizeBrand(found.brand)

    return {
      matchKey: matcher.keyFor({
        ean,
        storeId: this.deps.gateway.storeId,
        name: found.name,
        size,
      }),
      gtin14: ean?.gtin14 ?? null,
      name: found.name,
      description: trimDescription(found.description),
      brand,
      sizeAmount: size?.amount ?? null,
      sizeUnit: size?.unit ?? null,
      imageUrl: found.imageUrl,
      searchText: nameParser.buildSearchText(found.name, brand),
    }
  }

  /**
   * One offer per product per run. A product found under several terms would
   * otherwise get several identical rows, which would make the price history
   * lumpy for no reason.
   */
  private toOffers(
    pending: ReadonlyArray<{ matchKey: string; product: CatalogProduct }>,
    ids: ReadonlyMap<string, string>,
    collectedAt: Date,
  ): OfferInsert[] {
    const offers = new Map<string, OfferInsert>()

    for (const { matchKey, product } of pending) {
      const productId = ids.get(matchKey)
      if (!productId || offers.has(productId)) continue

      const price = Money.fromReais(product.priceReais)
      if (price.cents <= 0) continue

      const listPrice =
        product.listPriceReais !== null ? Money.fromReais(product.listPriceReais) : null

      offers.set(productId, {
        productId,
        storeId: this.deps.gateway.storeId,
        priceCents: price.cents,
        listPriceCents: listPrice && listPrice.cents > price.cents ? listPrice.cents : null,
        url: product.url,
        inStock: product.inStock,
        collectedAt,
      })
    }

    return [...offers.values()]
  }
}

/**
 * Catalogue blurbs run from a useful sentence to a wall of marketing with
 * HTML in it. Tags are stripped, whitespace collapsed, and anything past a
 * paragraph is cut — the listing shows two lines of this, not an essay.
 */
function trimDescription(raw: string | null): string | null {
  if (!raw) return null

  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length < 10) return null
  return text.length > 400 ? `${text.slice(0, 400).trimEnd()}…` : text
}

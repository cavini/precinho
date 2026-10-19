import { describe, expect, it } from 'vitest'
import { ProductMatcher } from '@/domain/services/ProductMatcher'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '../ports/StoreCatalogGateway'
import type { CatalogWriter, OfferInsert, ProductUpsert } from '../ports/CatalogWriter'
import { FixedClock } from '../testing/FixedClock'
import { RecordingLogger } from '../testing/RecordingLogger'
import { RecordingMetrics } from '../testing/RecordingMetrics'
import { CollectStoreOffers } from './CollectStoreOffers'

const NOW = new Date('2026-10-19T06:00:00Z')

function aCatalogProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    externalId: 'x1',
    ean: '7894900027013',
    name: 'Refrigerante Coca-Cola 2L',
    brand: 'COCA-COLA',
    imageUrl: 'https://example.com/a.jpg',
    url: 'https://www.mambo.com.br/coca-2l/p',
    priceReais: 14.98,
    listPriceReais: null,
    inStock: true,
    ...overrides,
  }
}

/** Answers per term, so a sweep can be made to fail halfway. */
class StubGateway implements StoreCatalogGateway {
  readonly asked: string[] = []

  constructor(
    readonly storeId: string,
    private readonly byTerm: Record<string, CatalogSearchResult>,
  ) {}

  async searchTerm(term: string): Promise<CatalogSearchResult> {
    this.asked.push(term)
    return this.byTerm[term] ?? { status: 'ok', products: [] }
  }
}

class RecordingWriter implements CatalogWriter {
  upserted: ProductUpsert[] = []
  inserted: OfferInsert[] = []

  async upsertProducts(products: readonly ProductUpsert[]): Promise<ReadonlyMap<string, string>> {
    this.upserted = [...products]
    // Mimics the database handing an id back per match key.
    return new Map(products.map((product, index) => [product.matchKey, `id-${index}`]))
  }

  async insertOffers(offers: readonly OfferInsert[]): Promise<number> {
    this.inserted = [...offers]
    return offers.length
  }
}

function build(byTerm: Record<string, CatalogSearchResult>) {
  const gateway = new StubGateway('mambo', byTerm)
  const writer = new RecordingWriter()
  const logger = new RecordingLogger()
  const metrics = new RecordingMetrics()

  const useCase = new CollectStoreOffers({
    gateway,
    writer,
    nameParser: new ProductNameParser(),
    matcher: new ProductMatcher(),
    logger,
    metrics,
    clock: new FixedClock(NOW),
  })

  return { useCase, gateway, writer, logger, metrics }
}

const ok = (products: CatalogProduct[]): CatalogSearchResult => ({ status: 'ok', products })

describe('CollectStoreOffers', () => {
  describe('what it stores', () => {
    it('stores a product with its parsed size and tidied brand', async () => {
      const { useCase, writer } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.upserted).toHaveLength(1)
      expect(writer.upserted[0]).toMatchObject({
        gtin14: '07894900027013',
        name: 'Refrigerante Coca-Cola 2L',
        brand: 'Coca-Cola',
        sizeAmount: 2,
        sizeUnit: 'L',
        matchKey: 'gtin:07894900027013',
      })
    })

    it('builds the search text the listing will match on', async () => {
      const { useCase, writer } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.upserted[0].searchText).toBe('refrigerante coca-cola 2l')
    })

    it('writes one offer per product with the price in cents', async () => {
      const { useCase, writer } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.inserted).toHaveLength(1)
      expect(writer.inserted[0]).toMatchObject({
        storeId: 'mambo',
        priceCents: 1498,
        url: 'https://www.mambo.com.br/coca-2l/p',
        inStock: true,
        collectedAt: NOW,
      })
    })

    it('records a promotion only when the list price is higher', async () => {
      const { useCase, writer } = build({
        coca: ok([
          aCatalogProduct({ ean: '7894900027013', priceReais: 10.49, listPriceReais: 14.98 }),
          aCatalogProduct({ ean: '7898215152002', priceReais: 10.49, listPriceReais: 9.99 }),
        ]),
      })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.inserted.map((offer) => offer.listPriceCents)).toEqual([1498, null])
    })

    it('keeps an out-of-stock product, flagged', async () => {
      const { useCase, writer } = build({ coca: ok([aCatalogProduct({ inStock: false })]) })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.inserted[0].inStock).toBe(false)
    })
  })

  describe('deduplication within a run', () => {
    it('stores a product found under two terms once', async () => {
      const product = aCatalogProduct()
      const { useCase, writer } = build({
        coca: ok([product]),
        refrigerante: ok([product]),
      })

      await useCase.execute({ terms: ['coca', 'refrigerante'] })

      expect(writer.upserted).toHaveLength(1)
      // One offer too: several identical rows would make price history lumpy
      // for no reason.
      expect(writer.inserted).toHaveLength(1)
    })

    it('keeps two genuinely different products apart', async () => {
      const { useCase, writer } = build({
        leite: ok([
          aCatalogProduct({ ean: '7894900027013', name: 'Coca 2L' }),
          aCatalogProduct({ ean: '7898215152002', name: 'Leite Condensado 395g' }),
        ]),
      })

      await useCase.execute({ terms: ['leite'] })
      expect(writer.upserted).toHaveLength(2)
    })
  })

  describe('barcodes', () => {
    it('keys on the barcode so other stores can merge with it', async () => {
      const { useCase, writer } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.upserted[0].matchKey).toBe('gtin:07894900027013')
    })

    it('keeps a product with no barcode store-local, and counts it', async () => {
      const { useCase, writer } = build({
        banana: ok([aCatalogProduct({ ean: null, name: 'Banana Prata' })]),
      })

      const report = await useCase.execute({ terms: ['banana'] })

      expect(writer.upserted[0].matchKey).toBe('store:mambo:banana-prata')
      expect(writer.upserted[0].gtin14).toBeNull()
      // Absent, not unusable.
      expect(report.discarded.unusableEan).toBe(0)
    })

    it('counts a barcode that fails its checksum, and still stores the product', async () => {
      // I want to see how much of a catalogue cannot be compared.
      const { useCase, writer } = build({
        coca: ok([aCatalogProduct({ ean: '7894900027014' })]),
      })

      const report = await useCase.execute({ terms: ['coca'] })

      expect(report.discarded.unusableEan).toBe(1)
      expect(writer.upserted).toHaveLength(1)
      expect(writer.upserted[0].gtin14).toBeNull()
    })
  })

  describe('rows it will not store', () => {
    it.each([
      { label: 'a zero price', product: { priceReais: 0 } },
      { label: 'a negative price', product: { priceReais: -1 } },
      { label: 'a price that is not a number', product: { priceReais: Number.NaN } },
      { label: 'no name', product: { name: '' } },
    ])('discards $label and says so in the report', async ({ product }) => {
      const { useCase, writer } = build({ x: ok([aCatalogProduct(product)]) })

      const report = await useCase.execute({ terms: ['x'] })

      expect(report.discarded.unpriceable).toBe(1)
      expect(writer.upserted).toEqual([])
      expect(writer.inserted).toEqual([])
    })
  })

  describe('a run that half worked', () => {
    it('carries on after a term the store would not answer', async () => {
      // Stores rate-limit and go down mid-sweep. One bad term is not a failed run.
      const { useCase, writer } = build({
        coca: { status: 'unavailable', reason: 'http-error' },
        leite: ok([aCatalogProduct({ ean: '7898215152002', name: 'Leite 1L' })]),
      })

      const report = await useCase.execute({ terms: ['coca', 'leite'] })

      expect(report.termsAttempted).toBe(2)
      expect(report.termsFailed).toBe(1)
      expect(writer.upserted).toHaveLength(1)
    })

    it('reports a sweep where every term failed without writing anything', async () => {
      const { useCase, writer } = build({
        coca: { status: 'unavailable', reason: 'timeout' },
      })

      const report = await useCase.execute({ terms: ['coca'] })

      expect(report.termsFailed).toBe(1)
      expect(report.offersWritten).toBe(0)
      expect(writer.inserted).toEqual([])
    })

    it('does not call the writer with an empty offer list', async () => {
      // Avoids a pointless round trip on a fully failed store.
      const { useCase, writer } = build({ coca: { status: 'unavailable', reason: 'timeout' } })
      await useCase.execute({ terms: ['coca'] })

      expect(writer.inserted).toEqual([])
    })
  })

  describe('observability', () => {
    it('reports what the run did, per store', async () => {
      const { useCase, logger } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      const [line] = logger.find('collector.store_finished')
      expect(line.fields).toMatchObject({
        storeId: 'mambo',
        productsSeen: 1,
        productsStored: 1,
        offersWritten: 1,
      })
    })

    it('counts a failed term so a bad night is visible the next morning', async () => {
      const { useCase, metrics } = build({ coca: { status: 'unavailable', reason: 'timeout' } })
      await useCase.execute({ terms: ['coca'] })

      expect(metrics.total('collector.term_failed')).toBe(1)
    })

    it('times each store', async () => {
      const { useCase, metrics } = build({ coca: ok([aCatalogProduct()]) })
      await useCase.execute({ terms: ['coca'] })

      expect(metrics.timings.map((t) => t.name)).toContain('collector.store_ms')
    })
  })
})

import { describe, expect, it } from 'vitest'
import { plainSpaces } from '@/testing/plainSpaces'
import { OfferComparator } from '@/domain/services/OfferComparator'
import { FixedClock } from '../testing/FixedClock'
import {
  InMemoryProductRepository,
  InMemoryStoreRepository,
  UnreadableStoreRepository,
} from '../testing/InMemoryRepositories'
import { RecordingLogger } from '../testing/RecordingLogger'
import { RecordingMetrics } from '../testing/RecordingMetrics'
import { AllowingRateLimiter, DenyingRateLimiter } from '../testing/StubRateLimiter'
import {
  COCA_COLA_2L,
  COLLECTED_AT,
  REGION_SP,
  STORES,
  aProduct,
  anOffer,
} from '../testing/fixtures'
import { GetProductDetail } from './GetProductDetail'

const SP_STORES = ['mambo', 'hortifruti', 'naturaldaterra']

const OFFERS = [
  anOffer(COCA_COLA_2L.id, 'mambo', 14.98, { listPriceReais: 17.99 }),
  anOffer(COCA_COLA_2L.id, 'hortifruti', 10.49),
  anOffer(COCA_COLA_2L.id, 'naturaldaterra', 9.99, { inStock: false }),
  // An earlier run for the same store: history, not a competing offer.
  anOffer(COCA_COLA_2L.id, 'mambo', 12.5, {
    collectedAt: new Date(COLLECTED_AT.getTime() - 86_400_000),
  }),
]

function build(options: { denied?: boolean; now?: Date; namelessStores?: boolean } = {}) {
  const logger = new RecordingLogger()
  const metrics = new RecordingMetrics()

  const useCase = new GetProductDetail({
    productRepository: new InMemoryProductRepository([COCA_COLA_2L], OFFERS, STORES),
    storeRepository: options.namelessStores
      ? new UnreadableStoreRepository(STORES)
      : new InMemoryStoreRepository(STORES),
    comparator: new OfferComparator(),
    rateLimiter: options.denied ? new DenyingRateLimiter(15) : new AllowingRateLimiter(),
    logger,
    metrics,
    clock: new FixedClock(options.now ?? new Date('2026-10-19T12:00:00Z')),
  })

  return { useCase, logger, metrics }
}

function detail(useCase: GetProductDetail, productId = COCA_COLA_2L.id, storeIds = SP_STORES) {
  return useCase.execute({ productId, regionId: REGION_SP.id, storeIds, clientKey: 'ip-hash' })
}

describe('GetProductDetail', () => {
  describe('the price list', () => {
    it('describes the product', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.product.name).toBe('Refrigerante Coca-Cola 2L')
      expect(result.product.brand).toBe('Coca-Cola')
      expect(result.product.size).toBe('2 L')
      expect(result.product.ean).toBe('7894900027013')
    })

    it('lists every store with its price and link', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.offers.map((offer) => offer.storeName)).toEqual([
        'Hortifruti',
        'Mambo',
        'Natural da Terra',
      ])
      expect(result.offers[0].url).toBe('https://example.com/hortifruti/coca-2l')
    })

    it('puts the cheapest first and marks which it is', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cheapestStoreId).toBe('hortifruti')
      expect(result.offers[0].isCheapest).toBe(true)
      expect(result.offers[1].isCheapest).toBe(false)
    })

    it('sinks an out-of-stock store to the bottom even when it is cheapest', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      const last = result.offers[result.offers.length - 1]
      expect(last.storeName).toBe('Natural da Terra')
      expect(last.inStock).toBe(false)
      expect(result.cheapestStoreId).not.toBe('naturaldaterra')
    })

    it('ignores an earlier run for the same store', async () => {
      // Offers are append-only, so only the latest row per store is a price.
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      const mambo = result.offers.find((offer) => offer.storeId === 'mambo')
      expect(plainSpaces(mambo!.priceLabel)).toBe('R$ 14,98')
      expect(result.offers.filter((offer) => offer.storeId === 'mambo')).toHaveLength(1)
    })

    it('shows the price per litre on every row', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(plainSpaces(result.offers[0].unitPriceLabel!)).toBe('R$ 5,25/L')
    })

    it("reports a store's own promotion against its list price", async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      const mambo = result.offers.find((offer) => offer.storeId === 'mambo')
      expect(plainSpaces(mambo!.discount!.amountLabel)).toBe('R$ 3,01')
    })

    it('says what switching to the cheapest store saves', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(plainSpaces(result.spread!.amountLabel)).toBe('R$ 4,49')
    })
  })

  describe('how old the prices are', () => {
    it('reports when each price was collected', async () => {
      const { useCase } = build()
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.offers[0].collectedAt).toBe(COLLECTED_AT.toISOString())
      expect(result.offers[0].isStale).toBe(false)
    })

    it('flags prices too old to present as current', async () => {
      // A week-old price is a guess, and the screen has to say so.
      const { useCase } = build({ now: new Date('2026-10-26T12:00:00Z') })
      const result = await detail(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.offers.every((offer) => offer.isStale)).toBe(true)
    })
  })

  describe('nothing to show', () => {
    it('reports a product that does not exist', async () => {
      const { useCase } = build()
      expect((await detail(useCase, 'nope')).status).toBe('not-found')
    })

    it('reports a product with no prices in the chosen stores', async () => {
      const { useCase } = build()
      const result = await detail(useCase, COCA_COLA_2L.id, ['zonasul'])
      expect(result.status).toBe('no-offers')
    })

    it('refuses an empty store pick rather than showing every store', async () => {
      const { useCase } = build()
      expect((await detail(useCase, COCA_COLA_2L.id, [])).status).toBe('no-stores-selected')
    })

    it('turns away a flood', async () => {
      const { useCase } = build({ denied: true })
      expect(await detail(useCase)).toMatchObject({
        status: 'rate-limited',
        retryAfterSeconds: 15,
      })
    })
  })

  describe('a product the catalogue barely describes', () => {
    it('reports nulls rather than inventing a brand, size or barcode', async () => {
      const bare = aProduct({ id: 'bare', name: 'Produto Solto', searchText: 'produto solto' })
      const useCase = new GetProductDetail({
        productRepository: new InMemoryProductRepository(
          [bare],
          [anOffer(bare.id, 'mambo', 4.99)],
          STORES,
        ),
        storeRepository: new InMemoryStoreRepository(STORES),
        comparator: new OfferComparator(),
        rateLimiter: new AllowingRateLimiter(),
        logger: new RecordingLogger(),
        metrics: new RecordingMetrics(),
        clock: new FixedClock(new Date('2026-10-19T12:00:00Z')),
      })

      const result = await useCase.execute({
        productId: bare.id,
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        clientKey: 'ip-hash',
      })

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.product.brand).toBeNull()
      expect(result.product.size).toBeNull()
      expect(result.product.ean).toBeNull()
      expect(result.offers[0].unitPriceLabel).toBeNull()
      expect(result.offers[0].discount).toBeNull()
      // One store, so nothing to compare against.
      expect(result.spread).toBeNull()
      expect(result.offers[0].isCheapest).toBe(true)
    })

    it('falls back to the store id when the store row has gone', async () => {
      // A store deactivated between a collection run and this read must not
      // take the page down.
      const useCase = new GetProductDetail({
        productRepository: new InMemoryProductRepository(
          [COCA_COLA_2L],
          [anOffer(COCA_COLA_2L.id, 'mambo', 14.98)],
          STORES,
        ),
        storeRepository: new InMemoryStoreRepository([]),
        comparator: new OfferComparator(),
        rateLimiter: new AllowingRateLimiter(),
        logger: new RecordingLogger(),
        metrics: new RecordingMetrics(),
        clock: new FixedClock(new Date('2026-10-19T12:00:00Z')),
      })

      const result = await useCase.execute({
        productId: COCA_COLA_2L.id,
        regionId: REGION_SP.id,
        storeIds: ['mambo'],
        clientKey: 'ip-hash',
      })

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.offers[0].storeName).toBe('mambo')
    })
  })

  describe('observability', () => {
    it('counts outcomes by status', async () => {
      const { useCase, metrics } = build()
      await detail(useCase)
      await detail(useCase, 'nope')

      expect(metrics.total('product_detail.execute', ['status', 'ok'])).toBe(1)
      expect(metrics.total('product_detail.execute', ['status', 'not-found'])).toBe(1)
    })

    it('logs how many stores were compared', async () => {
      const { useCase, logger } = build()
      await detail(useCase)

      const [line] = logger.find('product_detail.completed')
      expect(line.fields.offerCount).toBe(3)
      expect(line.fields.productId).toBe(COCA_COLA_2L.id)
    })
  })
})

describe('GetProductDetail when the shop list cannot be read', () => {
  it('still answers, because that list only supplies the shop names', async () => {
    const { useCase } = build({ namelessStores: true })

    expect((await detail(useCase)).status).toBe('ok')
  })
})

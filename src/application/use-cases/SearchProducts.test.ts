import { describe, expect, it } from 'vitest'
import { plainSpaces } from '@/testing/plainSpaces'
import type {
  FeedCriteria,
  ProductRepository,
  ProductSearchHit,
  SearchCriteria,
} from '../ports/ProductRepository'
import { FixedClock } from '../testing/FixedClock'
import { InMemoryProductRepository, InMemoryStoreRepository } from '../testing/InMemoryRepositories'
import { RecordingLogger } from '../testing/RecordingLogger'
import { RecordingMetrics } from '../testing/RecordingMetrics'
import { AllowingRateLimiter, DenyingRateLimiter } from '../testing/StubRateLimiter'
import {
  BANANA,
  COCA_COLA_2L,
  CONDENSED_MILK,
  REGION_SP,
  STORES,
  aProduct,
  anOffer,
} from '../testing/fixtures'
import { SearchProducts } from './SearchProducts'

/** The trap: "pacoca" contains "coca" as a substring. */
const PACOCA = aProduct({
  id: 'pacoca',
  name: 'Paçoca Rolha Santa Helena 1kg',
  searchText: 'pacoca rolha santa helena 1kg',
})

const PRODUCTS = [COCA_COLA_2L, CONDENSED_MILK, BANANA, PACOCA]

const OFFERS = [
  anOffer(COCA_COLA_2L.id, 'mambo', 14.98),
  anOffer(COCA_COLA_2L.id, 'hortifruti', 10.49),
  anOffer(CONDENSED_MILK.id, 'mambo', 7.69),
  anOffer(CONDENSED_MILK.id, 'naturaldaterra', 10.79),
  anOffer(BANANA.id, 'mambo', 5.99, { inStock: false }),
]

const SP_STORES = ['mambo', 'hortifruti', 'naturaldaterra']

/** Wraps the reference repository to assert it was never consulted. */
class CountingProductRepository implements ProductRepository {
  searches = 0

  constructor(private readonly inner: ProductRepository) {}

  async search(criteria: SearchCriteria): Promise<readonly ProductSearchHit[]> {
    this.searches += 1
    return this.inner.search(criteria)
  }

  feed(criteria: FeedCriteria) {
    return this.inner.feed(criteria)
  }

  findById(productId: string) {
    return this.inner.findById(productId)
  }

  listOffers(productId: string, storeIds: readonly string[]) {
    return this.inner.listOffers(productId, storeIds)
  }
}

function build(options: { denied?: boolean } = {}) {
  const repository = new CountingProductRepository(
    new InMemoryProductRepository(PRODUCTS, OFFERS, STORES),
  )
  const logger = new RecordingLogger()
  const metrics = new RecordingMetrics()

  const useCase = new SearchProducts({
    productRepository: repository,
    storeRepository: new InMemoryStoreRepository(STORES),
    rateLimiter: options.denied ? new DenyingRateLimiter(20) : new AllowingRateLimiter(),
    logger,
    metrics,
    clock: new FixedClock(new Date('2026-10-19T12:00:00Z')),
  })

  return { useCase, repository, logger, metrics }
}

function search(useCase: SearchProducts, rawQuery: string, storeIds = SP_STORES) {
  return useCase.execute({
    rawQuery,
    regionId: REGION_SP.id,
    storeIds,
    clientKey: 'ip-hash',
  })
}

describe('SearchProducts', () => {
  describe('the listing a shopper reads', () => {
    it('names the cheapest store and its price', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      const [item] = result.items

      expect(item.name).toBe('Refrigerante Coca-Cola 2L')
      expect(item.cheapest?.storeName).toBe('Hortifruti')
      expect(plainSpaces(item.cheapest!.priceLabel)).toBe('R$ 10,49')
    })

    it('shows how much is on the table between stores', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(plainSpaces(result.items[0].spread!.amountLabel)).toBe('R$ 4,49')
      expect(result.items[0].spread?.percent).toBeCloseTo(29.97, 1)
    })

    it('shows the price per unit, which is what settles a comparison', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(plainSpaces(result.items[0].cheapest!.unitPriceLabel!)).toBe('R$ 5,25/L')
    })

    it('says how many of the chosen stores have it', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].availableStoreCount).toBe(2)
    })

    it('omits the price per unit when the size is unknown', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'banana')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].size).toBeNull()
      expect(result.items[0].cheapest).toBeNull()
    })

    it('links straight to the product page at that store', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].cheapest?.url).toBe('https://example.com/hortifruti/coca-2l')
    })
  })

  describe('matching words, not substrings', () => {
    it('does not find pacoca when you search for coca', async () => {
      // Substring matching made this the second result on the real site.
      const { useCase } = build()
      const result = await search(useCase, 'coca')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items.map((item) => item.name)).not.toContain('Paçoca Rolha Santa Helena 1kg')
    })

    it('still matches a word by its beginning', async () => {
      // "refri" has to keep finding "refrigerante", so the anchor is the
      // start of a word rather than the whole word.
      const { useCase } = build()
      const result = await search(useCase, 'refri')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items.map((item) => item.name)).toContain('Refrigerante Coca-Cola 2L')
    })

    it('matches a word after a hyphen', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'cola')

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items.map((item) => item.name)).toContain('Refrigerante Coca-Cola 2L')
    })
  })

  describe('the store picker', () => {
    it('only prices the stores the shopper picked', async () => {
      // Somebody who never shops at Hortifruti should not be told to go there.
      const { useCase } = build()
      const result = await search(useCase, 'coca', ['mambo'])

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].cheapest?.storeName).toBe('Mambo')
      expect(result.items[0].availableStoreCount).toBe(1)
      expect(result.items[0].spread).toBeNull()
    })

    it('refuses to search with nothing picked rather than quietly using every store', async () => {
      const { useCase, repository } = build()
      const result = await search(useCase, 'coca', [])

      expect(result.status).toBe('no-stores-selected')
      expect(repository.searches).toBe(0)
    })

    it('ignores a store from another region', async () => {
      const { useCase } = build()
      const result = await search(useCase, 'coca', [...SP_STORES, 'zonasul'])

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].availableStoreCount).toBe(2)
    })
  })

  describe('input that should never reach the database', () => {
    it('rejects a query too short to be selective', async () => {
      const { useCase, repository } = build()
      expect((await search(useCase, 'a')).status).toBe('invalid-query')
      expect(repository.searches).toBe(0)
    })

    it('rejects an over-long query', async () => {
      const { useCase, repository } = build()
      expect((await search(useCase, 'x'.repeat(200))).status).toBe('invalid-query')
      expect(repository.searches).toBe(0)
    })

    it('caps the page size however large a limit is asked for', async () => {
      const { useCase } = build()
      const result = await useCase.execute({
        rawQuery: 'leite',
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        limit: 10_000,
        clientKey: 'ip-hash',
      })

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.appliedLimit).toBe(SearchProducts.MAX_LIMIT)
    })

    it.each([0, -5, Number.NaN, undefined])(
      'falls back to the default page size for a limit of %s',
      async (limit) => {
        const { useCase } = build()
        const result = await useCase.execute({
          rawQuery: 'leite',
          regionId: REGION_SP.id,
          storeIds: SP_STORES,
          limit,
          clientKey: 'ip-hash',
        })

        if (result.status !== 'ok') throw new Error(result.status)
        expect(result.appliedLimit).toBe(SearchProducts.DEFAULT_LIMIT)
      },
    )

    it('falls back to the store id when the store row has gone', async () => {
      const useCase = new SearchProducts({
        productRepository: new InMemoryProductRepository(PRODUCTS, OFFERS, STORES),
        storeRepository: new InMemoryStoreRepository([]),
        rateLimiter: new AllowingRateLimiter(),
        logger: new RecordingLogger(),
        metrics: new RecordingMetrics(),
        clock: new FixedClock(new Date('2026-10-19T12:00:00Z')),
      })

      const result = await useCase.execute({
        rawQuery: 'coca',
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        clientKey: 'ip-hash',
      })

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.items[0].cheapest?.storeName).toBe('hortifruti')
    })

    it('turns away a flood before touching the database', async () => {
      const { useCase, repository } = build({ denied: true })
      const result = await search(useCase, 'coca')

      expect(result).toMatchObject({ status: 'rate-limited', retryAfterSeconds: 20 })
      expect(repository.searches).toBe(0)
    })
  })

  describe('observability', () => {
    it('counts outcomes by status', async () => {
      const { useCase, metrics } = build()
      await search(useCase, 'coca')
      await search(useCase, 'a')

      expect(metrics.total('search.execute', ['status', 'ok'])).toBe(1)
      expect(metrics.total('search.execute', ['status', 'invalid-query'])).toBe(1)
    })

    it('times the query so a slow search is visible', async () => {
      const { useCase, metrics } = build()
      await search(useCase, 'coca')
      expect(metrics.timings.map((t) => t.name)).toContain('search.query_ms')
    })

    it('logs the normalised query and the result count, not raw input', async () => {
      const { useCase, logger } = build()
      await search(useCase, '  COCA  ')

      const [line] = logger.find('search.completed')
      expect(line.fields.query).toBe('coca')
      expect(line.fields.resultCount).toBe(1)
    })

    it('records a search that found nothing, which is what drives what to collect next', async () => {
      const { useCase, metrics } = build()
      await search(useCase, 'quinoa')
      expect(metrics.total('search.empty')).toBe(1)
    })
  })
})

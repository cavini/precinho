import { describe, expect, it } from 'vitest'
import { plainSpaces } from '@/testing/plainSpaces'
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
  anOffer,
  aProduct,
} from '../testing/fixtures'
import { GetProductFeed } from './GetProductFeed'

const SP_STORES = ['mambo', 'hortifruti', 'naturaldaterra']

/** Coca is in two stores, condensed milk in three, banana in one. */
const OFFERS = [
  anOffer(COCA_COLA_2L.id, 'mambo', 14.98),
  anOffer(COCA_COLA_2L.id, 'hortifruti', 10.49),
  anOffer(CONDENSED_MILK.id, 'mambo', 7.69),
  anOffer(CONDENSED_MILK.id, 'naturaldaterra', 10.79),
  anOffer(CONDENSED_MILK.id, 'hortifruti', 8.99),
  anOffer(BANANA.id, 'mambo', 5.99),
]

const PRODUCTS = [
  { ...COCA_COLA_2L, imageUrl: 'https://example.com/coca.jpg' },
  { ...CONDENSED_MILK, imageUrl: 'https://example.com/leite.jpg' },
  BANANA,
]

function build(options: { denied?: boolean } = {}) {
  const logger = new RecordingLogger()
  const metrics = new RecordingMetrics()

  const useCase = new GetProductFeed({
    productRepository: new InMemoryProductRepository(PRODUCTS, OFFERS, STORES),
    storeRepository: new InMemoryStoreRepository(STORES),
    rateLimiter: options.denied ? new DenyingRateLimiter(10) : new AllowingRateLimiter(),
    logger,
    metrics,
  })

  return { useCase, logger, metrics }
}

function feed(useCase: GetProductFeed, storeIds = SP_STORES) {
  return useCase.execute({ regionId: REGION_SP.id, storeIds, clientKey: 'ip-hash' })
}

describe('GetProductFeed', () => {
  describe('the cards', () => {
    it('leads with the product where switching saves the most', async () => {
      // The one thing this app has to say is "you are overpaying for this".
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards[0].name).toBe('Refrigerante Coca-Cola 2L')
      expect(plainSpaces(result.cards[0].savingsLabel)).toBe('R$ 4,49')
    })

    it('lists every store that has it, cheapest first', async () => {
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      const milk = result.cards.find((c) => c.name.includes('Condensado'))!

      expect(milk.offers.map((o) => o.storeName)).toEqual([
        'Mambo',
        'Hortifruti',
        'Natural da Terra',
      ])
      expect(plainSpaces(milk.offers[0].priceLabel)).toBe('R$ 7,69')
    })

    it('marks which of them is the cheapest', async () => {
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards[0].offers.map((o) => o.isCheapest)).toEqual([true, false])
    })

    it('carries the picture and the price per unit', async () => {
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards[0].imageUrl).toBe('https://example.com/coca.jpg')
      expect(plainSpaces(result.cards[0].unitPriceLabel!)).toBe('R$ 5,25/L')
    })

    it('gives every offer a link, because the card has to be actionable', async () => {
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards[0].offers.every((o) => o.url.startsWith('https://'))).toBe(true)
    })
  })

  describe('what the feed leaves out', () => {
    it('drops a product only one store carries', async () => {
      // One price is not a comparison, so it has nothing to say here.
      const { useCase } = build()
      const result = await feed(useCase)

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards.map((c) => c.name)).not.toContain('Banana Prata')
    })

    it('drops a product that falls to one store once the picker narrows', async () => {
      const { useCase } = build()
      const result = await feed(useCase, ['mambo', 'naturaldaterra'])

      if (result.status !== 'ok') throw new Error(result.status)
      // Coca is only in mambo and hortifruti, so narrowing removes it.
      expect(result.cards.map((c) => c.name)).not.toContain('Refrigerante Coca-Cola 2L')
      expect(result.cards.map((c) => c.name)).toContain('Leite Condensado Piracanjuba 395g')
    })

    it('returns nothing rather than erroring when no product qualifies', async () => {
      const { useCase } = build()
      const result = await feed(useCase, ['mambo'])

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards).toEqual([])
    })
  })

  describe('limits', () => {
    it('caps the page however large a limit is asked for', async () => {
      const many = Array.from({ length: 40 }, (_, i) =>
        aProduct({ id: `p${i}`, name: `Produto ${i}`, searchText: `produto ${i}` }),
      )
      const offers = many.flatMap((p) => [
        anOffer(p.id, 'mambo', 10 + i(p.id)),
        anOffer(p.id, 'hortifruti', 20 + i(p.id)),
      ])
      const useCase = new GetProductFeed({
        productRepository: new InMemoryProductRepository(many, offers, STORES),
        storeRepository: new InMemoryStoreRepository(STORES),
        rateLimiter: new AllowingRateLimiter(),
        logger: new RecordingLogger(),
        metrics: new RecordingMetrics(),
      })

      const result = await useCase.execute({
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        limit: 1000,
        clientKey: 'ip-hash',
      })

      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards).toHaveLength(GetProductFeed.MAX_LIMIT)
    })

    it('refuses an empty store pick rather than showing every store', async () => {
      expect((await feed(build().useCase, [])).status).toBe('no-stores-selected')
    })

    it('turns away a flood', async () => {
      const { useCase } = build({ denied: true })
      expect(await feed(useCase)).toMatchObject({ status: 'rate-limited', retryAfterSeconds: 10 })
    })
  })

  describe('paging', () => {
    /** Forty comparable products, so there is something to page through. */
    function manyCards() {
      const products = Array.from({ length: 40 }, (_, index) =>
        aProduct({
          id: `p${String(index).padStart(2, '0')}`,
          name: `Produto ${index}`,
          searchText: `produto ${index}`,
          imageUrl: `https://example.com/${index}.jpg`,
        }),
      )
      const offers = products.flatMap((product, index) => [
        anOffer(product.id, 'mambo', 10 + index),
        anOffer(product.id, 'hortifruti', 12 + index * 1.5),
      ])

      return new GetProductFeed({
        productRepository: new InMemoryProductRepository(products, offers, STORES),
        storeRepository: new InMemoryStoreRepository(STORES),
        rateLimiter: new AllowingRateLimiter(),
        logger: new RecordingLogger(),
        metrics: new RecordingMetrics(),
      })
    }

    const page = (useCase: GetProductFeed, offset: number, limit = 6) =>
      useCase.execute({
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        limit,
        offset,
        clientKey: 'ip-hash',
      })

    it('returns a different page for a different offset', async () => {
      const useCase = manyCards()
      const first = await page(useCase, 0)
      const second = await page(useCase, 6)

      if (first.status !== 'ok' || second.status !== 'ok') throw new Error('expected ok')
      const firstIds = first.cards.map((c) => c.productId)
      const secondIds = second.cards.map((c) => c.productId)

      expect(firstIds).toHaveLength(6)
      // No overlap: a repeated card would render twice in the scroll.
      expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([])
    })

    it('says there is more while a page comes back full', async () => {
      const result = await page(manyCards(), 0)
      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.hasMore).toBe(true)
    })

    it('says there is no more once a page comes back short', async () => {
      // Asking again after a short page costs a round trip to learn nothing.
      const result = await page(manyCards(), 36)
      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards.length).toBeLessThan(6)
      expect(result.hasMore).toBe(false)
    })

    it('returns nothing past the end rather than wrapping around', async () => {
      const result = await page(manyCards(), 500)
      if (result.status !== 'ok') throw new Error(result.status)
      expect(result.cards).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('treats a nonsense offset as the beginning', async () => {
      const useCase = manyCards()
      const negative = await page(useCase, -10)
      const start = await page(useCase, 0)

      if (negative.status !== 'ok' || start.status !== 'ok') throw new Error('expected ok')
      expect(negative.cards.map((c) => c.productId)).toEqual(start.cards.map((c) => c.productId))
    })

    it('defaults to the first page when no offset is given', async () => {
      const useCase = manyCards()
      const implicit = await useCase.execute({
        regionId: REGION_SP.id,
        storeIds: SP_STORES,
        limit: 6,
        clientKey: 'ip-hash',
      })

      if (implicit.status !== 'ok') throw new Error(implicit.status)
      const explicit = await page(useCase, 0)
      if (explicit.status !== 'ok') throw new Error(explicit.status)

      expect(implicit.cards.map((c) => c.productId)).toEqual(explicit.cards.map((c) => c.productId))
    })
  })

  describe('observability', () => {
    it('counts outcomes and reports how full the feed was', async () => {
      const { useCase, logger, metrics } = build()
      await feed(useCase)

      expect(metrics.total('feed.execute', ['status', 'ok'])).toBe(1)
      expect(logger.find('feed.completed')[0].fields.cardCount).toBe(2)
    })
  })
})

/** Spreads the generated prices so the ranking has something to order by. */
function i(id: string): number {
  return Number(id.replace('p', ''))
}

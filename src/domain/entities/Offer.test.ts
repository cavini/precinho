import { describe, expect, it } from 'vitest'
import { Money } from '../value-objects/Money'
import { Quantity } from '../value-objects/Quantity'
import { Offer } from './Offer'

const COLLECTED_AT = new Date('2026-10-19T12:00:00Z')

function anOffer(overrides: Partial<Parameters<typeof Offer.create>[0]> = {}) {
  return Offer.create({
    storeId: 'mambo',
    price: Money.fromReais(10.49),
    listPrice: null,
    url: 'https://www.mambo.com.br/coca-cola-2l/p',
    inStock: true,
    collectedAt: COLLECTED_AT,
    ...overrides,
  })
}

describe('Offer', () => {
  it('holds what a shopper needs to act on a price', () => {
    const offer = anOffer()
    expect(offer.price.cents).toBe(1049)
    expect(offer.storeId).toBe('mambo')
    expect(offer.url).toBe('https://www.mambo.com.br/coca-cola-2l/p')
    expect(offer.inStock).toBe(true)
  })

  it('exposes the promotion price and the collection time', () => {
    const offer = anOffer({ listPrice: Money.fromReais(14.98) })
    expect(offer.listPrice?.cents).toBe(1498)
    expect(offer.collectedAt).toEqual(COLLECTED_AT)
    expect(anOffer({ listPrice: null }).listPrice).toBeNull()
  })

  it('refuses a price of zero, which is not something you can buy', () => {
    // Catalogues report an unlisted item as price 0. It is a row to drop, not
    // a free product, and the rule belongs here so it holds for every caller.
    expect(() => anOffer({ price: Money.fromCents(0) })).toThrow(/price/i)
  })

  it('refuses an offer with no store behind it', () => {
    expect(() => anOffer({ storeId: '' })).toThrow(/store/i)
  })

  describe('the link, which is rendered as an anchor', () => {
    it('accepts an absolute http(s) url', () => {
      expect(() => anOffer({ url: 'http://example.com/p' })).not.toThrow()
      expect(() => anOffer({ url: 'https://example.com/p' })).not.toThrow()
    })

    it('rejects a scheme that would execute instead of navigate', () => {
      // A collector bug or a poisoned catalogue must not reach the DOM as a
      // javascript: or data: link.
      expect(() => anOffer({ url: 'javascript:alert(1)' })).toThrow(/url/i)
      expect(() => anOffer({ url: 'data:text/html,<script>' })).toThrow(/url/i)
    })

    it('rejects a relative or empty url, which would link nowhere useful', () => {
      expect(() => anOffer({ url: '/coca-cola/p' })).toThrow(/url/i)
      expect(() => anOffer({ url: '' })).toThrow(/url/i)
    })
  })

  describe('staleness', () => {
    it('is fresh within the window', () => {
      const sixHoursLater = new Date(COLLECTED_AT.getTime() + 6 * 3_600_000)
      expect(anOffer().isStale(sixHoursLater, 48)).toBe(false)
    })

    it('goes stale past the window, so no screen claims it is current', () => {
      const threeDaysLater = new Date(COLLECTED_AT.getTime() + 72 * 3_600_000)
      expect(anOffer().isStale(threeDaysLater, 48)).toBe(true)
    })

    it('counts age from collection, not from now going backwards', () => {
      const before = new Date(COLLECTED_AT.getTime() - 3_600_000)
      expect(anOffer().isStale(before, 48)).toBe(false)
    })
  })

  describe('price per unit', () => {
    it('divides by the product size when there is one', () => {
      expect(anOffer().unitPrice(Quantity.of(2, 'L'))?.centsPerUnit).toBe(524.5)
    })

    it('declines to invent one when the size is unknown', () => {
      expect(anOffer().unitPrice(null)).toBeNull()
    })
  })

  describe('discount against the list price', () => {
    it('reports the saving when the store is running a promotion', () => {
      const offer = anOffer({ price: Money.fromReais(10.49), listPrice: Money.fromReais(14.98) })
      expect(offer.discount()?.amount.cents).toBe(449)
      expect(offer.discount()?.percent).toBeCloseTo(29.97, 1)
    })

    it('reports nothing when the list price matches the price', () => {
      const offer = anOffer({ price: Money.fromReais(10.49), listPrice: Money.fromReais(10.49) })
      expect(offer.discount()).toBeNull()
    })

    it('reports nothing when the list price is lower, which is bad data', () => {
      const offer = anOffer({ price: Money.fromReais(14.98), listPrice: Money.fromReais(10.49) })
      expect(offer.discount()).toBeNull()
    })

    it('reports nothing when there is no list price', () => {
      expect(anOffer({ listPrice: null }).discount()).toBeNull()
    })
  })
})

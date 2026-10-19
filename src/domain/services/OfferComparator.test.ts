import { describe, expect, it } from 'vitest'
import { Offer } from '../entities/Offer'
import { Money } from '../value-objects/Money'
import { OfferComparator } from './OfferComparator'

const comparator = new OfferComparator()
const COLLECTED_AT = new Date('2026-10-19T12:00:00Z')

function offer(storeId: string, reais: number, inStock = true): Offer {
  return Offer.create({
    storeId,
    price: Money.fromReais(reais),
    listPrice: null,
    url: `https://example.com/${storeId}`,
    inStock,
    collectedAt: COLLECTED_AT,
  })
}

// The real spread I measured on Coca-Cola 2L across two São Paulo chains.
const COCA_COLA = [offer('mambo', 14.98), offer('hortifruti', 10.49)]

describe('OfferComparator', () => {
  it('names the cheapest store', () => {
    expect(comparator.compare(COCA_COLA).cheapest?.storeId).toBe('hortifruti')
  })

  it('ranks from cheapest to dearest', () => {
    expect(comparator.compare(COCA_COLA).ranked.map((o) => o.storeId)).toEqual([
      'hortifruti',
      'mambo',
    ])
  })

  it('reports what the shopper saves by switching', () => {
    const { spread } = comparator.compare(COCA_COLA)
    expect(spread?.amount.cents).toBe(449)
    expect(spread?.percent).toBeCloseTo(29.97, 1)
  })

  describe('stock', () => {
    it('will not call an out-of-stock price the cheapest', () => {
      // Quoting a price nobody can buy is the easiest way to lose trust.
      const offers = [offer('mambo', 14.98), offer('hortifruti', 8.99, false)]
      expect(comparator.compare(offers).cheapest?.storeId).toBe('mambo')
    })

    it('still lists the out-of-stock offer, after the available ones', () => {
      const offers = [offer('hortifruti', 8.99, false), offer('mambo', 14.98)]
      expect(comparator.compare(offers).ranked.map((o) => o.storeId)).toEqual([
        'mambo',
        'hortifruti',
      ])
    })

    it('ignores out-of-stock prices when measuring the spread', () => {
      const offers = [offer('mambo', 14.98), offer('hortifruti', 10.49), offer('zonasul', 2, false)]
      expect(comparator.compare(offers).spread?.amount.cents).toBe(449)
    })

    it('has no cheapest when nothing is in stock', () => {
      const result = comparator.compare([offer('mambo', 14.98, false)])
      expect(result.cheapest).toBeNull()
      expect(result.ranked).toHaveLength(1)
    })
  })

  describe('nothing to compare', () => {
    it('handles no offers at all', () => {
      const result = comparator.compare([])
      expect(result.cheapest).toBeNull()
      expect(result.ranked).toEqual([])
      expect(result.spread).toBeNull()
    })

    it('reports no spread for a single offer', () => {
      const result = comparator.compare([offer('mambo', 14.98)])
      expect(result.cheapest?.storeId).toBe('mambo')
      expect(result.spread).toBeNull()
    })

    it('reports no spread when every store charges the same', () => {
      const result = comparator.compare([offer('mambo', 3.99), offer('hortifruti', 3.99)])
      expect(result.spread).toBeNull()
    })
  })

  describe('determinism', () => {
    it('breaks a tie on store id, so the order never shuffles between loads', () => {
      const result = comparator.compare([offer('zonasul', 3.99), offer('hortifruti', 3.99)])
      expect(result.ranked.map((o) => o.storeId)).toEqual(['hortifruti', 'zonasul'])
      expect(result.cheapest?.storeId).toBe('hortifruti')
    })

    it('does not reorder the array it was given', () => {
      const offers = [offer('mambo', 14.98), offer('hortifruti', 10.49)]
      comparator.compare(offers)
      expect(offers.map((o) => o.storeId)).toEqual(['mambo', 'hortifruti'])
    })
  })
})

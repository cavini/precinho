import { describe, expect, it } from 'vitest'
import { Money } from '../value-objects/Money'
import { ComparablePrices } from './ComparablePrices'

const policy = new ComparablePrices()

const reais = (...values: number[]) => values.map((v) => Money.fromReais(v))
const asReais = (prices: readonly Money[]) => prices.map((p) => p.toReais())

describe('ComparablePrices', () => {
  describe('prices that really are the same product', () => {
    it('keeps a spread that is merely large', () => {
      // Measured on real data: Serrano ham ranges 24,90 to 44,99 across four
      // São Paulo stores. That is a genuine 80% difference, not bad data.
      expect(asReais(policy.keepComparable(reais(24.9, 32.9, 44.99, 44.99)))).toEqual([
        24.9, 32.9, 44.99, 44.99,
      ])
    })

    it('keeps everything when the prices are close', () => {
      expect(asReais(policy.keepComparable(reais(6.59, 6.99, 6.99)))).toEqual([6.59, 6.99, 6.99])
    })

    it('keeps a pair that differ by less than the limit', () => {
      expect(asReais(policy.keepComparable(reais(29.98, 48.99)))).toEqual([29.98, 48.99])
    })
  })

  describe('prices that cannot be the same product', () => {
    it('drops the wholesale pack sold under the unit barcode', () => {
      // Sam's Club lists the six-pack under the single bottle's EAN, so the
      // merge is technically right and practically wrong. 35,98 against a
      // 6,59 bottle is a package difference, not a saving.
      expect(asReais(policy.keepComparable(reais(6.59, 6.99, 6.99, 35.98)))).toEqual([
        6.59, 6.99, 6.99,
      ])
    })

    it('drops a tenfold outlier', () => {
      expect(asReais(policy.keepComparable(reais(2.49, 2.49, 2.69, 25.48)))).toEqual([
        2.49, 2.49, 2.69,
      ])
    })

    it('leaves a lone price when the only other one is an outlier', () => {
      // Red Bull: 8,99 for the can against 31,56 for a four-pack. With one
      // price left there is nothing to compare, and the caller drops it.
      expect(asReais(policy.keepComparable(reais(8.99, 31.56)))).toEqual([8.99])
    })
  })

  describe('the boundary', () => {
    it('keeps a price exactly at the limit', () => {
      expect(asReais(policy.keepComparable(reais(10, 30)))).toEqual([10, 30])
    })

    it('drops a price just past it', () => {
      expect(asReais(policy.keepComparable(reais(10, 30.01)))).toEqual([10])
    })
  })

  describe('edges', () => {
    it('handles no prices', () => {
      expect(policy.keepComparable([])).toEqual([])
    })

    it('handles one price', () => {
      expect(asReais(policy.keepComparable(reais(9.9)))).toEqual([9.9])
    })

    it('does not care what order they arrive in', () => {
      const ascending = asReais(policy.keepComparable(reais(6.59, 35.98, 6.99)))
      const descending = asReais(policy.keepComparable(reais(35.98, 6.99, 6.59)))
      expect([...ascending].sort()).toEqual([...descending].sort())
    })

    it('does not reorder what it keeps', () => {
      expect(asReais(policy.keepComparable(reais(6.99, 6.59, 35.98)))).toEqual([6.99, 6.59])
    })
  })
})

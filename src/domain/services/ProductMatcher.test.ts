import { describe, expect, it } from 'vitest'
import { Ean } from '../value-objects/Ean'
import { Quantity } from '../value-objects/Quantity'
import { ProductMatcher } from './ProductMatcher'

const matcher = new ProductMatcher()

describe('ProductMatcher', () => {
  describe('products with a barcode', () => {
    it('keys on the barcode, so two chains land on one product', () => {
      const atMambo = matcher.keyFor({
        ean: Ean.tryParse('7894900027013'),
        storeId: 'mambo',
        name: 'Refrigerante Original Coca-Cola Garrafa 2L',
        size: Quantity.of(2, 'L'),
      })
      const atHortifruti = matcher.keyFor({
        ean: Ean.tryParse('7894900027013'),
        storeId: 'hortifruti',
        name: 'Coca Cola Refrigerante 2 Litros',
        size: Quantity.of(2, 'L'),
      })

      // Different names, different stores, same product.
      expect(atMambo).toBe(atHortifruti)
    })

    it('keys the same whether a store reports EAN-13 or GTIN-14', () => {
      const asEan13 = matcher.keyFor({
        ean: Ean.tryParse('7894900027013'),
        storeId: 'a',
        name: 'x',
        size: null,
      })
      const asGtin14 = matcher.keyFor({
        ean: Ean.tryParse('07894900027013'),
        storeId: 'b',
        name: 'x',
        size: null,
      })
      expect(asEan13).toBe(asGtin14)
    })

    it('keeps different products apart', () => {
      const coke = matcher.keyFor({
        ean: Ean.tryParse('7894900027013'),
        storeId: 'a',
        name: 'Coca 2L',
        size: null,
      })
      const condensedMilk = matcher.keyFor({
        ean: Ean.tryParse('7898215152002'),
        storeId: 'a',
        name: 'Leite Condensado',
        size: null,
      })
      expect(coke).not.toBe(condensedMilk)
    })
  })

  describe('products without a usable barcode', () => {
    it('keeps them store-local rather than merging on name alone', () => {
      // Loose produce has no barcode. "Banana Prata" at two stores is not
      // provably the same item, and a wrong merge quotes the wrong price.
      const atMambo = matcher.keyFor({
        ean: null,
        storeId: 'mambo',
        name: 'Banana Prata',
        size: null,
      })
      const atHortifruti = matcher.keyFor({
        ean: null,
        storeId: 'hortifruti',
        name: 'Banana Prata',
        size: null,
      })
      expect(atMambo).not.toBe(atHortifruti)
    })

    it('still recognises the same item across collection runs', () => {
      const firstRun = matcher.keyFor({ ean: null, storeId: 'mambo', name: 'Banana Prata', size: null })
      const secondRun = matcher.keyFor({ ean: null, storeId: 'mambo', name: 'banana  prata', size: null })
      expect(firstRun).toBe(secondRun)
    })

    it('separates two sizes of the same name', () => {
      const small = matcher.keyFor({ ean: null, storeId: 'mambo', name: 'Pao', size: Quantity.of(0.5, 'kg') })
      const large = matcher.keyFor({ ean: null, storeId: 'mambo', name: 'Pao', size: Quantity.of(1, 'kg') })
      expect(small).not.toBe(large)
    })
  })

  describe('indexBy — how a collection run finds existing products', () => {
    it('builds a lookup in one pass', () => {
      const products = [
        { key: 'gtin:07894900027013', id: 'p1' },
        { key: 'store:mambo:banana-prata', id: 'p2' },
      ]
      const index = matcher.indexBy(products, (p) => p.key)

      expect(index.get('gtin:07894900027013')?.id).toBe('p1')
      expect(index.get('nope')).toBeUndefined()
    })

    it('keeps the first entry when a key repeats', () => {
      const index = matcher.indexBy(
        [
          { key: 'k', id: 'first' },
          { key: 'k', id: 'second' },
        ],
        (p) => p.key,
      )
      expect(index.get('k')?.id).toBe('first')
    })
  })
})

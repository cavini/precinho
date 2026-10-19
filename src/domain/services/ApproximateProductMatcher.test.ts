import { describe, expect, it } from 'vitest'
import { Quantity } from '../value-objects/Quantity'
import { ApproximateProductMatcher } from './ApproximateProductMatcher'

const matcher = new ApproximateProductMatcher()

function candidate(id: string, name: string, size: Quantity | null) {
  return { id, name, size }
}

const kg = (n: number) => Quantity.of(n, 'kg')
const litre = (n: number) => Quantity.of(n, 'L')

describe('ApproximateProductMatcher', () => {
  describe('what it should merge', () => {
    it('matches the same product written two ways', () => {
      const a = candidate('a', 'Arroz Tio João Tipo 1 5kg', kg(5))
      const b = candidate('b', 'ARROZ TIO JOAO 5KG', kg(5))

      expect(matcher.compare(a, b).confident).toBe(true)
    })

    it('ignores punctuation and accents', () => {
      const a = candidate('a', 'Refrigerante Coca-Cola 2L', litre(2))
      const b = candidate('b', 'Refrigerante Coca Cola 2 Litros', litre(2))

      expect(matcher.compare(a, b).confident).toBe(true)
    })

    it('tolerates an extra descriptive word', () => {
      const a = candidate('a', 'Leite Condensado Piracanjuba 395g', kg(0.395))
      const b = candidate('b', 'Leite Condensado Piracanjuba Lata 395g', kg(0.395))

      expect(matcher.compare(a, b).confident).toBe(true)
    })
  })

  describe('what it must never merge', () => {
    it('refuses two brands of the same thing', () => {
      // The whole point of a comparison is that these are different products.
      const a = candidate('a', 'Arroz Tio João 5kg', kg(5))
      const b = candidate('b', 'Arroz Camil 5kg', kg(5))

      expect(matcher.compare(a, b).confident).toBe(false)
    })

    it('refuses different sizes of the same product', () => {
      const a = candidate('a', 'Arroz Tio João 5kg', kg(5))
      const b = candidate('b', 'Arroz Tio João 1kg', kg(1))

      expect(matcher.compare(a, b).confident).toBe(false)
    })

    it('refuses a match across units', () => {
      const a = candidate('a', 'Molho de Tomate Quero 1kg', kg(1))
      const b = candidate('b', 'Molho de Tomate Quero 1L', litre(1))

      expect(matcher.compare(a, b).confident).toBe(false)
    })

    describe('the modifier trap', () => {
      it('refuses the zero-sugar version of a drink', () => {
        // Token overlap alone scores these as a match, which is exactly the
        // kind of wrong merge that quotes somebody the wrong price.
        const a = candidate('a', 'Refrigerante Coca-Cola 2L', litre(2))
        const b = candidate('b', 'Refrigerante Coca-Cola Zero 2L', litre(2))

        expect(matcher.compare(a, b).confident).toBe(false)
      })

      it('refuses skimmed against whole milk', () => {
        const a = candidate('a', 'Leite Italac Integral 1L', litre(1))
        const b = candidate('b', 'Leite Italac Desnatado 1L', litre(1))

        expect(matcher.compare(a, b).confident).toBe(false)
      })

      it('refuses a lactose-free version', () => {
        const a = candidate('a', 'Leite Italac Integral 1L', litre(1))
        const b = candidate('b', 'Leite Italac Integral Sem Lactose 1L', litre(1))

        expect(matcher.compare(a, b).confident).toBe(false)
      })

      it('still matches when both carry the same modifier', () => {
        const a = candidate('a', 'Leite Italac Integral 1L', litre(1))
        const b = candidate('b', 'LEITE INTEGRAL ITALAC 1 LITRO', litre(1))

        expect(matcher.compare(a, b).confident).toBe(true)
      })
    })

    it('refuses when either size is unknown', () => {
      // Without a size there is nothing holding the match down.
      const a = candidate('a', 'Banana Prata', null)
      const b = candidate('b', 'Banana Prata', null)

      expect(matcher.compare(a, b).confident).toBe(false)
    })

    it('refuses two products that only share a category word', () => {
      const a = candidate('a', 'Arroz Camil 1kg', kg(1))
      const b = candidate('b', 'Arroz Prato Fino 1kg', kg(1))

      expect(matcher.compare(a, b).confident).toBe(false)
    })
  })

  describe('the score', () => {
    it('is higher the more the names agree', () => {
      const base = candidate('a', 'Arroz Tio João Tipo 1 5kg', kg(5))
      const near = matcher.compare(base, candidate('b', 'Arroz Tio João 5kg', kg(5))).score
      const far = matcher.compare(base, candidate('c', 'Arroz Camil 5kg', kg(5))).score

      expect(near).toBeGreaterThan(far)
    })

    it('is zero when the sizes rule the pair out, without scoring names', () => {
      const a = candidate('a', 'Arroz Tio João 5kg', kg(5))
      const b = candidate('b', 'Arroz Tio João 1kg', kg(1))

      expect(matcher.compare(a, b).score).toBe(0)
    })

    it('is symmetric', () => {
      const a = candidate('a', 'Arroz Tio João Tipo 1 5kg', kg(5))
      const b = candidate('b', 'Arroz Tio Joao 5kg', kg(5))

      expect(matcher.compare(a, b).score).toBe(matcher.compare(b, a).score)
    })
  })

  describe('grouping a catalogue', () => {
    it('puts the same product from three stores in one group', () => {
      const groups = matcher.group([
        candidate('mambo', 'Arroz Tio João Tipo 1 5kg', kg(5)),
        candidate('tenda', 'ARROZ TIO JOAO T1 5KG', kg(5)),
        candidate('tauste', 'Arroz Tio João 5kg', kg(5)),
      ])

      expect(groups).toHaveLength(1)
      expect(groups[0].map((c) => c.id).sort()).toEqual(['mambo', 'tauste', 'tenda'])
    })

    it('keeps different brands apart', () => {
      const groups = matcher.group([
        candidate('a', 'Arroz Tio João 5kg', kg(5)),
        candidate('b', 'Arroz Camil 5kg', kg(5)),
      ])

      expect(groups).toHaveLength(2)
    })

    it('leaves a product with no size on its own', () => {
      const groups = matcher.group([
        candidate('a', 'Banana Prata', null),
        candidate('b', 'Banana Prata', null),
      ])

      expect(groups).toHaveLength(2)
    })

    it('returns groups in a stable order', () => {
      // The listing renders these, so the order cannot shuffle between runs.
      const input = [
        candidate('c', 'Arroz Camil 1kg', kg(1)),
        candidate('a', 'Arroz Tio João 5kg', kg(5)),
        candidate('b', 'Arroz Tio Joao 5kg', kg(5)),
      ]

      const first = matcher.group(input).map((g) => g.map((c) => c.id).join('+'))
      const second = matcher.group([...input].reverse()).map((g) => g.map((c) => c.id).join('+'))

      expect(first.sort()).toEqual(second.sort())
    })

    it('handles an empty catalogue', () => {
      expect(matcher.group([])).toEqual([])
    })
  })
})

import { describe, expect, it } from 'vitest'
import { Money } from './Money'
import { Quantity } from './Quantity'
import { UnitPrice } from './UnitPrice'

describe('UnitPrice', () => {
  it('divides a price by its size', () => {
    const perKilo = UnitPrice.from(Money.fromReais(52.5), Quantity.of(5, 'kg'))
    expect(perKilo.centsPerUnit).toBe(1050)
    expect(perKilo.unit).toBe('kg')
  })

  it('is the number that settles which package is actually cheaper', () => {
    // The small bottle costs less and is worse value; this is the whole
    // reason price-per-unit exists on the listing.
    const can = UnitPrice.from(Money.fromReais(3.99), Quantity.of(0.35, 'L'))
    const bottle = UnitPrice.from(Money.fromReais(10.49), Quantity.of(2, 'L'))
    expect(can.isLessThan(bottle)).toBe(false)
    expect(bottle.isLessThan(can)).toBe(true)
  })

  it('refuses to compare across units, which would be meaningless', () => {
    const perKilo = UnitPrice.from(Money.fromReais(10), Quantity.of(1, 'kg'))
    const perLitre = UnitPrice.from(Money.fromReais(10), Quantity.of(1, 'L'))
    expect(() => perKilo.isLessThan(perLitre)).toThrow(/unit/i)
  })

  it('formats for the screen', () => {
    const perKilo = UnitPrice.from(Money.fromReais(52.5), Quantity.of(5, 'kg'))
    expect(perKilo.format().replace(/ /g, ' ')).toBe('R$ 10,50/kg')

    const perLitre = UnitPrice.from(Money.fromReais(10.49), Quantity.of(2, 'L'))
    expect(perLitre.format().replace(/ /g, ' ')).toBe('R$ 5,25/L')
  })

  it('is immutable', () => {
    const price = UnitPrice.from(Money.fromReais(10), Quantity.of(1, 'kg'))
    expect(() => {
      ;(price as unknown as { unit: string }).unit = 'L'
    }).toThrow()
  })
})

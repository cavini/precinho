import { describe, expect, it } from 'vitest'
import { Quantity } from './Quantity'

describe('Quantity', () => {
  it('keeps a canonical amount and unit', () => {
    const q = Quantity.of(5, 'kg')
    expect(q.amount).toBe(5)
    expect(q.unit).toBe('kg')
  })

  describe('fromMeasurement', () => {
    it('converts mass to kilograms', () => {
      expect(Quantity.fromMeasurement(200, 'g')).toEqual(Quantity.of(0.2, 'kg'))
      expect(Quantity.fromMeasurement(395, 'g')).toEqual(Quantity.of(0.395, 'kg'))
      expect(Quantity.fromMeasurement(1.6, 'kg')).toEqual(Quantity.of(1.6, 'kg'))
    })

    it('converts volume to litres', () => {
      expect(Quantity.fromMeasurement(350, 'ml')).toEqual(Quantity.of(0.35, 'L'))
      expect(Quantity.fromMeasurement(2, 'L')).toEqual(Quantity.of(2, 'L'))
      expect(Quantity.fromMeasurement(50, 'cl')).toEqual(Quantity.of(0.5, 'L'))
    })

    it('reads the Portuguese unit spellings the catalogues use', () => {
      expect(Quantity.fromMeasurement(1, 'litro')).toEqual(Quantity.of(1, 'L'))
      expect(Quantity.fromMeasurement(2, 'litros')).toEqual(Quantity.of(2, 'L'))
      expect(Quantity.fromMeasurement(12, 'unidades')).toEqual(Quantity.of(12, 'un'))
      expect(Quantity.fromMeasurement(6, 'rolos')).toEqual(Quantity.of(6, 'un'))
    })

    it('expands a dozen into units', () => {
      expect(Quantity.fromMeasurement(1, 'duzia')).toEqual(Quantity.of(12, 'un'))
      expect(Quantity.fromMeasurement(2, 'dz')).toEqual(Quantity.of(24, 'un'))
    })

    it('ignores casing', () => {
      expect(Quantity.fromMeasurement(500, 'ML')).toEqual(Quantity.of(0.5, 'L'))
    })

    it('returns null for a unit it does not know', () => {
      expect(Quantity.fromMeasurement(1, 'bananas')).toBeNull()
    })

    it('returns null for an amount that cannot be a size', () => {
      expect(Quantity.fromMeasurement(0, 'kg')).toBeNull()
      expect(Quantity.fromMeasurement(-1, 'kg')).toBeNull()
      expect(Quantity.fromMeasurement(Number.NaN, 'kg')).toBeNull()
    })
  })

  it('refuses a non-positive canonical amount', () => {
    expect(() => Quantity.of(0, 'kg')).toThrow(/positive/i)
  })

  it('compares only within the same unit', () => {
    expect(Quantity.of(1, 'kg').equals(Quantity.of(1, 'kg'))).toBe(true)
    expect(Quantity.of(1, 'kg').equals(Quantity.of(1, 'L'))).toBe(false)
  })

  it('labels itself for the screen', () => {
    expect(Quantity.of(0.395, 'kg').label()).toBe('395 g')
    expect(Quantity.of(2, 'kg').label()).toBe('2 kg')
    expect(Quantity.of(0.35, 'L').label()).toBe('350 ml')
    expect(Quantity.of(2, 'L').label()).toBe('2 L')
    expect(Quantity.of(12, 'un').label()).toBe('12 un')
  })
})

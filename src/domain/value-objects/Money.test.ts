import { describe, expect, it } from 'vitest'
import { Money } from './Money'

describe('Money', () => {
  it('stores whole cents so prices never drift', () => {
    expect(Money.fromCents(1049).cents).toBe(1049)
  })

  it('absorbs binary float dust when built from reais', () => {
    // 10.49 * 100 is 1048.9999999999998 in IEEE-754.
    expect(Money.fromReais(10.49).cents).toBe(1049)
    expect(Money.fromReais(0.07).cents).toBe(7)
    expect(Money.fromReais(52.5).cents).toBe(5250)
  })

  it('rounds a sub-cent value to the nearest cent', () => {
    expect(Money.fromReais(1.005).cents).toBe(101)
    expect(Money.fromReais(1.004).cents).toBe(100)
  })

  it('refuses a value that is not a usable price', () => {
    expect(() => Money.fromCents(Number.NaN)).toThrow(/finite/i)
    expect(() => Money.fromCents(Number.POSITIVE_INFINITY)).toThrow(/finite/i)
    expect(() => Money.fromCents(-1)).toThrow(/negative/i)
    expect(() => Money.fromCents(10.5)).toThrow(/whole cents/i)
    expect(() => Money.fromReais(Number.NaN)).toThrow(/finite/i)
    expect(() => Money.fromReais(Number.POSITIVE_INFINITY)).toThrow(/finite/i)
  })

  it('reads back as reais', () => {
    expect(Money.fromCents(1049).toReais()).toBe(10.49)
  })

  it('compares by amount', () => {
    expect(Money.fromCents(1049).isLessThan(Money.fromCents(1498))).toBe(true)
    expect(Money.fromCents(1498).isLessThan(Money.fromCents(1049))).toBe(false)
    expect(Money.fromCents(1049).equals(Money.fromCents(1049))).toBe(true)
  })

  it('subtracts to a difference', () => {
    expect(Money.fromCents(1498).minus(Money.fromCents(1049)).cents).toBe(449)
  })

  it('will not subtract into a negative price', () => {
    expect(() => Money.fromCents(1049).minus(Money.fromCents(1498))).toThrow(/negative/i)
  })

  it('formats as Brazilian currency for the screen', () => {
    // Non-breaking space is what Intl emits between symbol and digits.
    expect(Money.fromCents(1049).format().replace(/ /g, ' ')).toBe('R$ 10,49')
    expect(Money.fromCents(500).format().replace(/ /g, ' ')).toBe('R$ 5,00')
  })

  it('is immutable', () => {
    const price = Money.fromCents(1049)
    expect(() => {
      ;(price as unknown as { cents: number }).cents = 1
    }).toThrow()
  })
})

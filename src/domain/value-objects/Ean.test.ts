import { describe, expect, it } from 'vitest'
import { Ean } from './Ean'

// Captured from live store catalogues, so the check digits are real.
const REAL_EANS = [
  '7893500003151', // Arroz Tio João Nikkoh 5kg
  '7894900027013', // Coca-Cola 2L
  '7898080640222', // Creme de Leite Italac 200g
  '7896004400075', // Leite de Coco Sococo 200ml
  '7898215152002', // Leite Condensado Piracanjuba 395g
]

describe('Ean', () => {
  it.each(REAL_EANS)('accepts the real barcode %s', (code) => {
    expect(Ean.tryParse(code)?.value).toBe(code)
  })

  it('rejects a code whose check digit does not add up', () => {
    // Last digit bumped from 3 to 4.
    expect(Ean.tryParse('7894900027014')).toBeNull()
  })

  it('accepts every GTIN length', () => {
    expect(Ean.tryParse('96385074')).not.toBeNull() // GTIN-8
    expect(Ean.tryParse('036000291452')).not.toBeNull() // UPC-12
    expect(Ean.tryParse('07894900027013')).not.toBeNull() // GTIN-14
  })

  it('rejects a length that is not a GTIN', () => {
    expect(Ean.tryParse('123456789')).toBeNull()
    expect(Ean.tryParse('')).toBeNull()
  })

  it('rejects an internal store code masquerading as a barcode', () => {
    expect(Ean.tryParse('0000000000000')).toBeNull()
    expect(Ean.tryParse('SEM GTIN')).toBeNull()
  })

  it('trims surrounding whitespace the catalogue leaves in', () => {
    expect(Ean.tryParse(' 7894900027013 ')?.value).toBe('7894900027013')
  })

  it('refuses anything other than digits rather than stripping them', () => {
    // Stripping would silently turn a wrong code into a valid-looking one.
    expect(Ean.tryParse('789-4900027013')).toBeNull()
  })

  describe('gtin14 — the key products are matched on across stores', () => {
    it('left-pads every length to 14 digits', () => {
      expect(Ean.tryParse('7894900027013')!.gtin14).toBe('07894900027013')
      expect(Ean.tryParse('96385074')!.gtin14).toBe('00000096385074')
    })

    it('gives the same key whether a store reports EAN-13 or GTIN-14', () => {
      const asEan13 = Ean.tryParse('7894900027013')!
      const asGtin14 = Ean.tryParse('07894900027013')!
      expect(asEan13.gtin14).toBe(asGtin14.gtin14)
      expect(asEan13.equals(asGtin14)).toBe(true)
    })
  })
})

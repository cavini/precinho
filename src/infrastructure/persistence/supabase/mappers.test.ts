import { describe, expect, it } from 'vitest'
import { toOffer, toProduct, toQuantity, toRegion, toStore } from './mappers'

describe('toRegion', () => {
  it('maps a region row', () => {
    expect(
      toRegion({
        id: 'r1',
        slug: 'sao-paulo-sp',
        name: 'São Paulo',
        city: 'São Paulo',
        uf: 'SP',
        is_uf_default: true,
      }),
    ).toEqual({
      id: 'r1',
      slug: 'sao-paulo-sp',
      name: 'São Paulo',
      city: 'São Paulo',
      uf: 'SP',
      isUfDefault: true,
    })
  })
})

describe('toStore', () => {
  it('maps a store row and leaves collection config behind', () => {
    // host, platform and tokens are the collector's business, not the domain's.
    const store = toStore({
      id: 's1',
      slug: 'mambo',
      name: 'Mambo',
      chain: 'Mambo',
      region_id: 'r1',
    })

    expect(store).toEqual({
      id: 's1',
      slug: 'mambo',
      name: 'Mambo',
      chain: 'Mambo',
      regionId: 'r1',
    })
    expect(store).not.toHaveProperty('host')
  })
})

describe('toQuantity', () => {
  it('reads a numeric that Postgres returned as a string', () => {
    // numeric arrives as text so precision is not lost in transit.
    expect(toQuantity('0.3950', 'kg')?.amount).toBe(0.395)
  })

  it('reads a plain number', () => {
    expect(toQuantity(2, 'L')?.amount).toBe(2)
  })

  it.each([
    { label: 'a null amount', amount: null, unit: 'kg' },
    { label: 'a null unit', amount: 1, unit: null },
    { label: 'an unknown unit', amount: 1, unit: 'dozen' },
    { label: 'zero', amount: 0, unit: 'kg' },
    { label: 'a negative amount', amount: -1, unit: 'kg' },
    { label: 'unparseable text', amount: 'about a kilo', unit: 'kg' },
  ])('returns null for $label', ({ amount, unit }) => {
    expect(toQuantity(amount, unit)).toBeNull()
  })
})

describe('toProduct', () => {
  const FIELDS = {
    product_id: 'p1',
    name: 'Refrigerante Coca-Cola 2L',
    brand: 'Coca-Cola',
    size_amount: '2.0000',
    size_unit: 'L',
    image_url: 'https://example.com/a.jpg',
    gtin14: '07894900027013',
  }

  it('maps a product with a barcode', () => {
    const product = toProduct(FIELDS)

    expect(product.id).toBe('p1')
    expect(product.ean?.value).toBe('07894900027013')
    expect(product.size?.label()).toBe('2 L')
    expect(product.matchKey).toBe('gtin:07894900027013')
  })

  it('maps a product without one', () => {
    const product = toProduct({ ...FIELDS, gtin14: null, size_amount: null, size_unit: null })

    expect(product.ean).toBeNull()
    expect(product.size).toBeNull()
    // Keyed on its own id, so it stays distinct from anything else.
    expect(product.matchKey).toBe('product:p1')
  })

  it('discards a stored barcode that no longer verifies', () => {
    // Better to lose the merge than to trust a code that fails its checksum.
    const product = toProduct({ ...FIELDS, gtin14: '07894900027014' })
    expect(product.ean).toBeNull()
  })
})

describe('toOffer', () => {
  const ROW = {
    store_id: 's1',
    price_cents: 1049,
    list_price_cents: 1498,
    url: 'https://www.mambo.com.br/coca/p',
    in_stock: true,
    collected_at: '2026-10-19T06:00:00.000Z',
  }

  it('maps an offer row', () => {
    const offer = toOffer(ROW)!

    expect(offer.price.cents).toBe(1049)
    expect(offer.listPrice?.cents).toBe(1498)
    expect(offer.inStock).toBe(true)
    expect(offer.collectedAt.toISOString()).toBe('2026-10-19T06:00:00.000Z')
  })

  it('maps an offer with no promotion', () => {
    expect(toOffer({ ...ROW, list_price_cents: null })!.listPrice).toBeNull()
  })

  it.each([
    { label: 'a zero price', row: { price_cents: 0 } },
    { label: 'a negative price', row: { price_cents: -100 } },
    { label: 'a fractional cent', row: { price_cents: 10.5 } },
    { label: 'a relative url', row: { url: '/coca/p' } },
    { label: 'a javascript url', row: { url: 'javascript:alert(1)' } },
    { label: 'an unparseable date', row: { collected_at: 'last tuesday' } },
  ])('drops a row with $label rather than crashing the page', ({ row }) => {
    // One malformed offer should cost that offer, not the whole listing.
    expect(toOffer({ ...ROW, ...row })).toBeNull()
  })
})

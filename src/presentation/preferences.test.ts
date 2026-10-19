import { describe, expect, it } from 'vitest'
import { MAX_PICKED_STORES, parsePreferences, serializePreferences } from './preferences'

const REGION = '11111111-1111-4111-8111-111111111111'
const STORE_A = '22222222-2222-4222-8222-222222222222'
const STORE_B = '33333333-3333-4333-8333-333333333333'

const VALID = {
  postalCode: '01310100',
  regionId: REGION,
  storeIds: [STORE_A, STORE_B],
}

describe('preferences round trip', () => {
  it('survives being written and read back', () => {
    expect(parsePreferences(serializePreferences(VALID))).toEqual(VALID)
  })
})

describe('parsePreferences with a hostile or stale cookie', () => {
  it('asks for the CEP again rather than breaking', () => {
    // A bad cookie costing somebody one CEP entry beats a broken page.
    expect(parsePreferences(undefined)).toBeNull()
    expect(parsePreferences(null)).toBeNull()
    expect(parsePreferences('')).toBeNull()
    expect(parsePreferences('not json')).toBeNull()
    expect(parsePreferences('[]')).toBeNull()
    expect(parsePreferences('"a string"')).toBeNull()
    expect(parsePreferences('null')).toBeNull()
  })

  it('rejects a CEP that is not one', () => {
    expect(parsePreferences(JSON.stringify({ cep: '123', region: REGION, stores: [] }))).toBeNull()
    expect(
      parsePreferences(JSON.stringify({ cep: '00000000', region: REGION, stores: [] })),
    ).toBeNull()
    expect(parsePreferences(JSON.stringify({ region: REGION, stores: [] }))).toBeNull()
  })

  it('rejects a region id that is not a uuid', () => {
    // It reaches a query, so its shape is checked before it gets there.
    for (const region of ['', 'all', "' or 1=1--", '../../etc/passwd', 123]) {
      expect(parsePreferences(JSON.stringify({ cep: '01310100', region, stores: [] }))).toBeNull()
    }
  })

  it('drops store ids that are not uuids and keeps the rest', () => {
    const preferences = parsePreferences(
      JSON.stringify({
        cep: '01310100',
        region: REGION,
        stores: [STORE_A, 'drop table offers', 42, null, STORE_B],
      }),
    )

    expect(preferences?.storeIds).toEqual([STORE_A, STORE_B])
  })

  it('caps how many stores a cookie can carry', () => {
    // The list becomes a query predicate; unbounded is a way to make one
    // request expensive.
    const many = Array.from(
      { length: MAX_PICKED_STORES + 20 },
      (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
    )
    const preferences = parsePreferences(
      JSON.stringify({ cep: '01310100', region: REGION, stores: many }),
    )

    expect(preferences?.storeIds).toHaveLength(MAX_PICKED_STORES)
  })

  it('requires the store list to be a list', () => {
    expect(
      parsePreferences(JSON.stringify({ cep: '01310100', region: REGION, stores: 'all' })),
    ).toBeNull()
    expect(parsePreferences(JSON.stringify({ cep: '01310100', region: REGION }))).toBeNull()
  })

  it('accepts an empty store list, which means the picker was cleared', () => {
    // Distinct from no cookie at all: the shopper made a choice.
    const preferences = parsePreferences(
      JSON.stringify({ cep: '01310100', region: REGION, stores: [] }),
    )

    expect(preferences).toEqual({ postalCode: '01310100', regionId: REGION, storeIds: [] })
  })

  it('ignores fields it does not know, so an older cookie still works', () => {
    const preferences = parsePreferences(
      JSON.stringify({ cep: '01310100', region: REGION, stores: [STORE_A], theme: 'dark' }),
    )

    expect(preferences).toEqual({
      postalCode: '01310100',
      regionId: REGION,
      storeIds: [STORE_A],
    })
  })

  it('normalises a masked CEP it finds stored', () => {
    const preferences = parsePreferences(
      JSON.stringify({ cep: '01310-100', region: REGION, stores: [] }),
    )
    expect(preferences?.postalCode).toBe('01310100')
  })
})

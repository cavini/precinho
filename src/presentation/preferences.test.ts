import { describe, expect, it } from 'vitest'
import { MAX_PICKED_STORES, parsePreferences, serializePreferences } from './preferences'

const STORE_A = '22222222-2222-4222-8222-222222222222'
const STORE_B = '33333333-3333-4333-8333-333333333333'

const VALID = { storeIds: [STORE_A, STORE_B] }

describe('preferences round trip', () => {
  it('survives being written and read back', () => {
    expect(parsePreferences(serializePreferences(VALID))).toEqual(VALID)
  })
})

describe('parsePreferences with a hostile or stale cookie', () => {
  it('falls back to no preference rather than breaking', () => {
    // A bad cookie costing somebody their shop selection beats a broken
    // page; the screens treat no preference as every shop.
    expect(parsePreferences(undefined)).toBeNull()
    expect(parsePreferences(null)).toBeNull()
    expect(parsePreferences('')).toBeNull()
    expect(parsePreferences('not json')).toBeNull()
    expect(parsePreferences('[]')).toBeNull()
    expect(parsePreferences('"a string"')).toBeNull()
    expect(parsePreferences('null')).toBeNull()
  })

  it('drops store ids that are not uuids and keeps the rest', () => {
    // They reach a query predicate, so their shape is checked before
    // they get there.
    const preferences = parsePreferences(
      JSON.stringify({ stores: [STORE_A, 'drop table offers', 42, null, STORE_B] }),
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
    const preferences = parsePreferences(JSON.stringify({ stores: many }))

    expect(preferences?.storeIds).toHaveLength(MAX_PICKED_STORES)
  })

  it('requires the store list to be a list', () => {
    expect(parsePreferences(JSON.stringify({ stores: 'all' }))).toBeNull()
    expect(parsePreferences(JSON.stringify({}))).toBeNull()
  })

  it('accepts an empty store list, which means the picker was cleared', () => {
    expect(parsePreferences(JSON.stringify({ stores: [] }))).toEqual({ storeIds: [] })
  })

  it('ignores fields it does not know, so an older cookie still works', () => {
    // Cookies written before the postcode was dropped still carry one,
    // and a reader who gets a page instead of an error has not noticed
    // that anything changed.
    const preferences = parsePreferences(
      JSON.stringify({ cep: '01310100', region: 'anything', stores: [STORE_A], theme: 'dark' }),
    )

    expect(preferences).toEqual({ storeIds: [STORE_A] })
  })
})

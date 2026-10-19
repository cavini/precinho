import { describe, expect, it } from 'vitest'
import type { Region } from '../entities/Region'
import { RegionSelector } from './RegionSelector'

const selector = new RegionSelector()

function region(slug: string, city: string, uf: string, isUfDefault = false): Region {
  return { id: slug, slug, name: city, city, uf, isUfDefault }
}

const COVERED = [
  region('sao-paulo-sp', 'São Paulo', 'SP', true),
  region('ribeirao-preto-sp', 'Ribeirão Preto', 'SP'),
  region('rio-de-janeiro-rj', 'Rio de Janeiro', 'RJ', true),
]

describe('RegionSelector', () => {
  it('matches the shopper city exactly', () => {
    const result = selector.select(COVERED, { city: 'Ribeirão Preto', uf: 'SP' })
    expect(result.region?.slug).toBe('ribeirao-preto-sp')
    expect(result.kind).toBe('city')
  })

  it('matches regardless of accents and casing', () => {
    // ViaCEP returns "São Paulo"; a seed row may say "Sao Paulo".
    expect(selector.select(COVERED, { city: 'SAO PAULO', uf: 'SP' }).region?.slug).toBe(
      'sao-paulo-sp',
    )
  })

  it('falls back to the state default when the city is not covered', () => {
    const result = selector.select(COVERED, { city: 'Campinas', uf: 'SP' })
    expect(result.region?.slug).toBe('sao-paulo-sp')
    expect(result.kind).toBe('uf')
  })

  it('picks the flagged default rather than whichever sorts first', () => {
    // 'ribeirao-preto-sp' sorts before 'sao-paulo-sp'; alphabetical order is
    // an arbitrary way to choose where somebody shops.
    expect(selector.select(COVERED, { city: 'Santos', uf: 'SP' }).region?.slug).toBe(
      'sao-paulo-sp',
    )
  })

  it('never crosses state lines for a city of the same name', () => {
    // There is a Rio de Janeiro district in other states; the CEP's UF wins.
    const result = selector.select(COVERED, { city: 'Rio de Janeiro', uf: 'SP' })
    expect(result.region?.uf).toBe('SP')
    expect(result.kind).toBe('uf')
  })

  it('admits when a state has no coverage at all', () => {
    const result = selector.select(COVERED, { city: 'Manaus', uf: 'AM' })
    expect(result.region).toBeNull()
    expect(result.kind).toBe('none')
  })

  it('uses the only region in a state even when nothing is flagged', () => {
    const regions = [region('curitiba-pr', 'Curitiba', 'PR')]
    const result = selector.select(regions, { city: 'Londrina', uf: 'PR' })
    expect(result.region?.slug).toBe('curitiba-pr')
    expect(result.kind).toBe('uf')
  })

  it('refuses to guess between several unflagged regions in a state', () => {
    // Misconfigured seed data; silently picking one would send a shopper to
    // the wrong city's prices.
    const regions = [region('a-sc', 'Joinville', 'SC'), region('b-sc', 'Blumenau', 'SC')]
    const result = selector.select(regions, { city: 'Chapecó', uf: 'SC' })
    expect(result.region).toBeNull()
    expect(result.kind).toBe('none')
  })

  it('tolerates a lowercase or padded uf from the lookup', () => {
    expect(selector.select(COVERED, { city: 'São Paulo', uf: ' sp ' }).kind).toBe('city')
  })

  it('handles an empty coverage list', () => {
    expect(selector.select([], { city: 'São Paulo', uf: 'SP' }).kind).toBe('none')
  })
})

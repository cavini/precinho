import type { Region } from '../entities/Region'
import { normalizeText } from '../text/normalizeText'

export type RegionMatchKind =
  /** The shopper's own city is covered. */
  | 'city'
  /** Their city is not, so they are seeing the state's default region. */
  | 'uf'
  /** Nothing covers them. */
  | 'none'

export type RegionMatch = {
  region: Region | null
  kind: RegionMatchKind
}

/**
 * Maps a resolved address onto a region we actually have prices for.
 *
 * The `kind` matters as much as the region: a shopper in Campinas seeing São
 * Paulo prices has to be told so, or they will read a price as theirs and be
 * wrong at the till. Honest coverage is the difference between useful and
 * misleading.
 *
 * Stateless, so one instance is safely shared.
 */
export class RegionSelector {
  /**
   * Complexity: O(n) over the covered regions, which is a short list held in
   * memory; no allocation beyond the filtered slice.
   */
  select(regions: readonly Region[], address: { city: string; uf: string }): RegionMatch {
    const uf = address.uf.trim().toUpperCase()
    const city = normalizeText(address.city)

    const inState = regions.filter((region) => region.uf.trim().toUpperCase() === uf)
    if (inState.length === 0) return { region: null, kind: 'none' }

    const sameCity = inState.find((region) => normalizeText(region.city) === city)
    if (sameCity) return { region: sameCity, kind: 'city' }

    const flagged = inState.find((region) => region.isUfDefault)
    if (flagged) return { region: flagged, kind: 'uf' }

    // One region in the state is unambiguous even without the flag.
    if (inState.length === 1) return { region: inState[0], kind: 'uf' }

    // Several, none flagged: misconfigured data. Guessing would send a
    // shopper to another city's prices, so admit there is no answer.
    return { region: null, kind: 'none' }
  }
}

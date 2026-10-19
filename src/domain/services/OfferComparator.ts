import type { Offer } from '../entities/Offer'
import type { Money } from '../value-objects/Money'

/** How much is on the table between the cheapest and dearest available price. */
export type PriceSpread = {
  amount: Money
  percent: number
}

export type ComparisonResult = {
  /** Cheapest offer the shopper can actually buy, or null if none can. */
  cheapest: Offer | null
  /** Every offer, available ones first, each group cheapest to dearest. */
  ranked: readonly Offer[]
  /** Null when there is nothing to compare, or every store charges the same. */
  spread: PriceSpread | null
}

/**
 * Turns a product's offers into the comparison a shopper reads.
 *
 * Two rules carry the trust here. Out-of-stock prices never win: quoting a
 * price nobody can buy is the quickest way to make the whole site useless.
 * And ties break on store id, so the order is identical on every load rather
 * than shuffling under the reader.
 *
 * Stateless, so one instance is safely shared.
 */
export class OfferComparator {
  /**
   * Complexity: O(n log n), dominated by the ranking sort; the scans for
   * cheapest and dearest are O(n). Space is O(n) for the copy — the caller's
   * array is never reordered.
   */
  compare(offers: readonly Offer[]): ComparisonResult {
    const ranked = [...offers].sort(byAvailabilityThenPrice)
    const available = ranked.filter((offer) => offer.inStock)

    const cheapest = available[0] ?? null
    const dearest = available[available.length - 1] ?? null

    return { cheapest, ranked, spread: spreadBetween(cheapest, dearest) }
  }
}

/** Available first, then cheapest first, then store id to stay deterministic. */
function byAvailabilityThenPrice(a: Offer, b: Offer): number {
  if (a.inStock !== b.inStock) return a.inStock ? -1 : 1
  if (a.price.cents !== b.price.cents) return a.price.cents - b.price.cents
  return a.storeId.localeCompare(b.storeId)
}

function spreadBetween(cheapest: Offer | null, dearest: Offer | null): PriceSpread | null {
  if (!cheapest || !dearest || cheapest === dearest) return null

  const amount = dearest.price.minus(cheapest.price)
  if (amount.cents === 0) return null

  return { amount, percent: (amount.cents / dearest.price.cents) * 100 }
}

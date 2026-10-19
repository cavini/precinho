import type { Money } from '../value-objects/Money'

/**
 * How many times the cheapest price another one may be and still be
 * believed to be the same product.
 *
 * Three is calibrated against real São Paulo data: Serrano ham genuinely
 * ranges 24,90 to 44,99 across four chains (1.8x) and must survive, while a
 * six-pack listed under the single bottle's barcode comes in at 5.5x and
 * must not.
 *
 * The feed query in db/migrations/0007_comparable_feed.sql applies the same
 * ratio, because the ranking has to agree with what the cards show. If this
 * number changes, change it there too.
 */
export const MAX_PRICE_RATIO = 3

/**
 * Removes prices that cannot be for the same thing.
 *
 * Barcodes are shared between a unit and its multipack more often than they
 * should be, so a technically correct merge can put a 1,27L bottle next to
 * a six-pack of them. Nothing in the catalogue says which happened: the
 * names disagree, the sizes disagree, and only one of the two is right.
 *
 * So the rule is a refusal rather than a repair. A price far out of line
 * with the rest is dropped, not shown, because the honest position is that
 * we do not know it is the same product — and claiming a 29 reais saving
 * that is really a package difference is the single fastest way to make a
 * price comparison worthless.
 *
 * Stateless, so one instance is safely shared.
 */
export class ComparablePrices {
  /**
   * Returns the prices worth comparing, in the order given.
   *
   * Anchored on the cheapest rather than the median or the mean: those move
   * when half the rows are packs, and the cheapest is almost always the
   * single unit, which is what a shopper is pricing.
   *
   * Complexity: O(n), two passes and no sort.
   */
  keepComparable(prices: readonly Money[]): readonly Money[] {
    if (prices.length < 2) return prices

    let cheapest = prices[0]
    for (const price of prices) {
      if (price.isLessThan(cheapest)) cheapest = price
    }

    const ceiling = cheapest.cents * MAX_PRICE_RATIO
    return prices.filter((price) => price.cents <= ceiling)
  }
}

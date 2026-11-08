import type { Money } from '../value-objects/Money'

/**
 * How many times the cheapest price another one may be, when there is no
 * middle to judge against.
 *
 * Three is calibrated against real São Paulo data: Serrano ham genuinely
 * ranges 24,90 to 44,99 across four chains (1.8x) and must survive, while a
 * six-pack listed under the single bottle's barcode comes in at 5.5x and
 * must not.
 */
export const MAX_PRICE_RATIO = 3

/**
 * How far from the middle a price may sit when there are enough of them
 * to say where the middle is.
 *
 * Anchoring on the cheapest cannot tell a real spread from one bad row,
 * because both widen the same end. Read off the second region's feed, the two
 * look nothing alike:
 *
 *   real      12,98 / 22,49 / 29,90 / 34,99   a gradient across four shops
 *   bad       17,90 / 19,69 / 20,79 / 46,69   three agree, one is a pack
 *
 * Against the median those are 1.35x and 2.31x.
 *
 * 1.75 rather than 2, because a Heinz ketchup priced by five shops —
 * 11,99 / 18,49 / 18,99 / 19,99 and 34,98 at Sam's Club — put its
 * multipack 1.84x above the middle and reached the top of the feed at
 * "economize R$22,99". The cost of tightening is small and was measured
 * rather than feared: across the second region it refuses 106 prices out of
 * 15,869 against 84 at 2x, 0.7% either way, and the genuinely wide
 * survive — that chicken breast sits at 1.25x.
 */
export const MAX_MEDIAN_RATIO = 1.75

/**
 * How far *below* the middle a price may sit before it stops being a
 * bargain and starts being a different package.
 *
 * The ceiling above assumes the cheapest row is the honest one — true
 * while an expensive outlier is a multipack sharing a unit's barcode. It
 * stops being true when the product itself is the pack: a Red Bull
 * 4-pack priced by two shops at 35,96 and 39,98 also carried an Oba offer
 * at 9,99, because Oba publishes the pack's barcode on a single-can page.
 * Nothing above the middle to refuse, so the page called 9,99 the
 * cheapest and advertised a saving that was a package difference.
 *
 * Three, not 1.75, and the asymmetry is the point. An expensive outlier
 * is nearly always a pack; a cheap one is usually a wholesale club doing
 * its job. Measured over 34,015 prices on products carried by three or
 * more shops: a floor at 1.75 refuses 290, and the mildest are plainly
 * real — Baton 90g at 5,99 in Atacadão against a 10,49 median, Huggies
 * shampoo at 12,99 against 22,78. At three it refuses 19, and they read
 * as one list: Twix "Unidades de 15g" at 1,69 against 20,73, Trident
 * "Caixa com 21x8g" at 6,98 against 44,94, the Red Bull. Pack against
 * unit, every one.
 */
export const MIN_MEDIAN_RATIO = 3

/** Below this, there is no middle — only two ends and no way to tell. */
const ENOUGH_FOR_A_MIDDLE = 3

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
   * Anchored on the median once there are three prices, because with a
   * middle to judge by it is the only anchor that does not move when the
   * bad row is at one end: against the cheapest, a real spread and a
   * mismatch widen the same side and cannot be told apart.
   *
   * Below three there is no middle, and the cheapest is kept — it is
   * almost always the single unit, and a real price somebody can pay.
   *
   * Complexity: O(n), two passes and no sort.
   */
  keepComparable(prices: readonly Money[]): readonly Money[] {
    if (prices.length < 2) return prices

    if (prices.length >= ENOUGH_FOR_A_MIDDLE) {
      const middle = median(prices)
      const ceiling = middle * MAX_MEDIAN_RATIO
      const floor = middle / MIN_MEDIAN_RATIO
      return prices.filter((price) => price.cents <= ceiling && price.cents >= floor)
    }

    // Two prices and nothing to arbitrate. The cheapest is kept rather
    // than the pair refused, because it is almost always the single unit
    // and it is a real price somebody can pay: a Red Bull can at 8,99
    // against a four-pack at 31,56 under the same barcode leaves 8,99,
    // which the search listing is right to show even though the feed
    // will drop the card for having nothing left to compare against.
    let cheapest = prices[0]
    for (const price of prices) {
      if (price.isLessThan(cheapest)) cheapest = price
    }

    const ceiling = cheapest.cents * MAX_PRICE_RATIO
    return prices.filter((price) => price.cents <= ceiling)
  }
}

/**
 * The middle price, averaging the two middles when there is an even
 * number of them.
 *
 * Complexity: O(n log n) for the sort, over one product's offers.
 */
function median(prices: readonly Money[]): number {
  const cents = prices.map((price) => price.cents).sort((a, b) => a - b)
  const middle = Math.floor(cents.length / 2)

  return cents.length % 2 === 1 ? cents[middle] : (cents[middle - 1] + cents[middle]) / 2
}

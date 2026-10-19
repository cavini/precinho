import { normalizeText } from '../text/normalizeText'
import type { Ean } from '../value-objects/Ean'
import type { Quantity } from '../value-objects/Quantity'

export type MatchInput = {
  ean: Ean | null
  storeId: string
  name: string
  size: Quantity | null
}

/**
 * Decides when two catalogue rows are the same product.
 *
 * This is the hinge the whole app turns on: get it wrong in one direction and
 * the same milk appears three times and nothing is ever compared; wrong in
 * the other and a shopper is quoted a price for a different product.
 *
 * So the rule is deliberately conservative. A verified barcode merges across
 * stores. Without one, the product stays store-local — "Banana Prata" at two
 * chains is not provably the same item, and loose produce has no barcode at
 * all. Those still deduplicate within a store across runs, which is what
 * keeps price history continuous.
 *
 * Stateless, so one instance is safely shared.
 */
export class ProductMatcher {
  /**
   * Complexity: O(n) in the name length.
   */
  keyFor(input: MatchInput): string {
    if (input.ean) return `gtin:${input.ean.gtin14}`

    const name = normalizeText(input.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const size = input.size ? `:${input.size.amount}${input.size.unit}` : ''
    return `store:${input.storeId}:${name}${size}`
  }

  /**
   * Indexes known products by key so a collection run can look each
   * catalogue row up directly.
   *
   * This is the difference between a run that scales and one that does not:
   * one hash pass is O(n) to build and O(1) per lookup, where comparing each
   * incoming row against each known product would be O(n * m) — with
   * thousands of products per store and several stores, that is the whole
   * run's cost.
   *
   * First key wins, so a duplicate in the source cannot silently replace the
   * row already matched.
   */
  indexBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T> {
    const index = new Map<string, T>()
    for (const item of items) {
      const key = keyOf(item)
      if (!index.has(key)) index.set(key, item)
    }
    return index
  }
}

/**
 * A trading area — the set of stores that will deliver to one place.
 *
 * Online grocery prices are regional, so a region is the unit a shopper's
 * CEP resolves to and the unit a collection run is scoped by. Two stores in
 * different regions are never compared: their prices answer different
 * questions.
 */
export type Region = {
  id: string
  slug: string
  /** Shown on screen, e.g. "São Paulo". */
  name: string
  city: string
  /** Two-letter state code. */
  uf: string
  /**
   * Where CEPs in this state land when their own city is not covered.
   * Exactly one region per state should carry it.
   */
  isUfDefault: boolean
}

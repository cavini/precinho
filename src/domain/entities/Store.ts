/**
 * A store a shopper can buy from, in one region.
 *
 * Deliberately free of collection details — base URLs, sales channels and
 * platform quirks live with the gateway that talks to each catalogue. The
 * domain only needs to know who sells, under what banner, and where.
 */
export type Store = {
  id: string
  slug: string
  /** Shown on screen, e.g. "Mambo". */
  name: string
  /** The banner a store belongs to; two branches of one chain price alike. */
  chain: string
  regionId: string
}

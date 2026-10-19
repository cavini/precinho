import { DomainError } from '../errors/DomainError'
import type { Money } from '../value-objects/Money'
import type { Quantity } from '../value-objects/Quantity'
import { UnitPrice } from '../value-objects/UnitPrice'

const MILLISECONDS_PER_HOUR = 3_600_000

/** Schemes that navigate. Anything else must never reach an href. */
const NAVIGABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

export type OfferProps = {
  storeId: string
  price: Money
  /** The struck-through price, when the store is running a promotion. */
  listPrice: Money | null
  /** Absolute link to the product page at that store. */
  url: string
  inStock: boolean
  collectedAt: Date
}

/**
 * One store's price for one product, as of one collection run.
 *
 * Offers are append-only: a new run inserts a new row rather than updating
 * the old one, which makes price history a by-product of collecting instead
 * of a separate feature.
 *
 * Immutable.
 */
export class Offer {
  private constructor(private readonly props: OfferProps) {
    Object.freeze(this)
    Object.freeze(this.props)
  }

  /**
   * Validates the link at the boundary, because it is rendered as an anchor.
   * A collector bug or a poisoned catalogue must not be able to put a
   * `javascript:` or `data:` URL into the DOM.
   *
   * Complexity: O(n) in the URL length.
   */
  static create(props: OfferProps): Offer {
    let parsed: URL
    try {
      parsed = new URL(props.url)
    } catch {
      throw new DomainError(`Offer url must be absolute: ${JSON.stringify(props.url)}`)
    }
    if (!NAVIGABLE_PROTOCOLS.has(parsed.protocol)) {
      throw new DomainError(`Offer url must be http or https, got ${parsed.protocol}`)
    }
    if (!props.storeId) {
      throw new DomainError('An offer must belong to a store')
    }
    return new Offer(props)
  }

  get storeId(): string {
    return this.props.storeId
  }

  get price(): Money {
    return this.props.price
  }

  get listPrice(): Money | null {
    return this.props.listPrice
  }

  get url(): string {
    return this.props.url
  }

  get inStock(): boolean {
    return this.props.inStock
  }

  get collectedAt(): Date {
    return this.props.collectedAt
  }

  /** Null when the product size is unknown; O(1). */
  unitPrice(size: Quantity | null): UnitPrice | null {
    if (!size) return null
    return UnitPrice.from(this.props.price, size)
  }

  /**
   * Whether this price is too old to present as current. A clock behind the
   * collection time reads as fresh rather than negative-aged.
   *
   * Complexity: O(1).
   */
  isStale(now: Date, maxAgeHours: number): boolean {
    const ageMs = now.getTime() - this.props.collectedAt.getTime()
    if (ageMs < 0) return false
    return ageMs > maxAgeHours * MILLISECONDS_PER_HOUR
  }

  /**
   * The saving against the store's own list price, or null when there is no
   * promotion. A list price below the selling price is bad catalogue data and
   * is reported as no discount rather than as a negative one.
   *
   * Complexity: O(1).
   */
  discount(): { amount: Money; percent: number } | null {
    const { listPrice, price } = this.props
    if (!listPrice || !price.isLessThan(listPrice)) return null

    const amount = listPrice.minus(price)
    return { amount, percent: (amount.cents / listPrice.cents) * 100 }
  }
}

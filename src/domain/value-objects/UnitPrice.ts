import { DomainError } from '../errors/DomainError'
import { Money } from './Money'
import type { CanonicalUnit } from './Quantity'
import type { Quantity } from './Quantity'

/**
 * Price per kilo, litre or unit.
 *
 * This is the number that actually answers "which is cheaper": a 350ml can
 * at R$ 3,99 costs less than a 2L bottle at R$ 10,49 and is twice the price
 * per litre. Without it a listing sorted by price recommends the worse buy.
 *
 * Immutable.
 */
export class UnitPrice {
  private constructor(
    /** Kept fractional — it is derived for comparison and display, never summed. */
    readonly centsPerUnit: number,
    readonly unit: CanonicalUnit,
  ) {
    Object.freeze(this)
  }

  /** Complexity: O(1). */
  static from(price: Money, size: Quantity): UnitPrice {
    return new UnitPrice(price.cents / size.amount, size.unit)
  }

  /**
   * Throws across different units rather than returning a nonsense boolean —
   * R$/kg against R$/L has no answer, and a silent one would be a bug that
   * surfaces as a wrong recommendation.
   */
  isLessThan(other: UnitPrice): boolean {
    if (this.unit !== other.unit) {
      throw new DomainError(
        `Cannot compare unit prices in different units: ${this.unit} and ${other.unit}`,
      )
    }
    return this.centsPerUnit < other.centsPerUnit
  }

  /** Rounded to the cent for display, then formatted as pt-BR currency. */
  format(): string {
    return `${Money.fromCents(Math.round(this.centsPerUnit)).format()}/${this.unit}`
  }
}

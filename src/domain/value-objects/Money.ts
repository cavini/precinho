import { InvalidMoneyError } from '../errors/DomainError'

/**
 * A price, held as a whole number of cents.
 *
 * Money is never a float here. Store catalogues hand us reais as JSON
 * numbers, and comparing or summing those directly drifts — the entire point
 * of this app is saying which of two prices is lower, so the representation
 * has to be exact.
 *
 * Immutable; every operation returns a new instance.
 */
export class Money {
  private constructor(readonly cents: number) {
    Object.freeze(this)
  }

  /** Complexity: O(1). */
  static fromCents(cents: number): Money {
    if (!Number.isFinite(cents)) {
      throw new InvalidMoneyError('A price must be a finite number of cents')
    }
    if (!Number.isInteger(cents)) {
      throw new InvalidMoneyError('A price must be whole cents')
    }
    if (cents < 0) {
      throw new InvalidMoneyError('A price cannot be negative')
    }
    return new Money(cents)
  }

  /**
   * Builds from reais as the catalogues report them.
   *
   * Multiplying by 100 is not enough on its own: 10.49 * 100 is
   * 1048.9999999999998 and 1.005 * 100 is 100.49999999999999, so a plain
   * round loses a cent in one direction and a half-cent in the other.
   * Re-reading the product at 12 significant digits snaps it back onto the
   * decimal the store actually meant, and only then do we round.
   *
   * Complexity: O(1).
   */
  static fromReais(reais: number): Money {
    if (!Number.isFinite(reais)) {
      throw new InvalidMoneyError('A price must be a finite number of reais')
    }
    return Money.fromCents(Math.round(Number((reais * 100).toPrecision(12))))
  }

  toReais(): number {
    return this.cents / 100
  }

  isLessThan(other: Money): boolean {
    return this.cents < other.cents
  }

  equals(other: Money): boolean {
    return this.cents === other.cents
  }

  /** Throws rather than yielding a negative price; callers order the operands. */
  minus(other: Money): Money {
    return Money.fromCents(this.cents - other.cents)
  }

  /** Shown to a shopper, so pt-BR even though the code is English. */
  format(): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(this.toReais())
  }
}

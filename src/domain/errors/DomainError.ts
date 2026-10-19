/**
 * Base for every rule violation raised inside the domain layer.
 *
 * Domain errors are expected outcomes of bad input, not crashes: the
 * presentation layer maps them to a 4xx, never to a 500.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class InvalidMoneyError extends DomainError {}
export class InvalidQuantityError extends DomainError {}
export class InvalidRateLimitConfigError extends DomainError {}

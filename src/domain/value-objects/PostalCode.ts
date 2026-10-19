const CEP_LENGTH = 8

/**
 * A Brazilian CEP.
 *
 * Online grocery prices are regional, so the CEP decides which stores and
 * which prices a shopper sees. It is load-bearing, not decoration, which is
 * why it is a value object rather than a loose string.
 *
 * Immutable.
 */
export class PostalCode {
  private constructor(readonly digits: string) {
    Object.freeze(this)
  }

  /**
   * Accepts the masked form people type and rejects what could never
   * resolve, so an address lookup is never spent on a hopeless value.
   *
   * Complexity: O(n) in the length of the input.
   */
  static tryParse(input: string | null | undefined): PostalCode | null {
    if (!input) return null
    // Not truncated: nine digits is a typo, and silently cutting it would
    // accept a CEP the shopper never meant to enter.
    const digits = onlyDigits(input)

    if (digits.length !== CEP_LENGTH) return null
    // 00000000 and friends pass the mask but have no address behind them.
    if (/^(\d)\1{7}$/.test(digits)) return null

    return new PostalCode(digits)
  }

  get formatted(): string {
    return PostalCode.mask(this.digits)
  }

  equals(other: PostalCode): boolean {
    return this.digits === other.digits
  }

  /**
   * Formats a partial value while the field is being typed, dropping
   * anything past eight digits so the field cannot grow without bound.
   *
   * Complexity: O(n).
   */
  static mask(input: string): string {
    const digits = onlyDigits(input).slice(0, CEP_LENGTH)
    if (digits.length <= 5) return digits
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }
}

function onlyDigits(input: string): string {
  return input.replace(/\D/g, '')
}

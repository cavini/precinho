/** The GTIN lengths in circulation: EAN-8, UPC-12, EAN-13, GTIN-14. */
const VALID_LENGTHS = new Set([8, 12, 13, 14])

/** Every GTIN is keyed at 14 digits, the GS1 canonical width. */
const KEY_WIDTH = 14

/**
 * A product barcode — the only reliable way to tell that two stores are
 * selling the same thing.
 *
 * Catalogues put internal codes in the EAN field, so the check digit is
 * verified rather than trusted. A product whose code fails verification is
 * kept as store-local instead of being merged with somebody else's, because
 * a wrong merge shows a shopper a price for a product they are not looking
 * at — worse than showing no comparison at all.
 *
 * Immutable.
 */
export class Ean {
  private constructor(
    readonly value: string,
    /** Left-padded to 14 digits. Two stores reporting the same product as
     *  EAN-13 and GTIN-14 land on one key. */
    readonly gtin14: string,
  ) {
    Object.freeze(this)
  }

  /**
   * Returns null for anything that is not a verifiable GTIN.
   *
   * Non-digits are rejected outright rather than stripped: stripping turns a
   * mistyped code into a valid-looking one that points at another product.
   *
   * Complexity: O(d) in the number of digits, so O(1) in practice.
   */
  static tryParse(input: string | null | undefined): Ean | null {
    if (!input) return null
    const digits = input.trim()

    if (!VALID_LENGTHS.has(digits.length)) return null
    if (!/^\d+$/.test(digits)) return null
    // All-zeros passes the checksum but is a placeholder, not a product.
    if (/^0+$/.test(digits)) return null
    if (!hasValidCheckDigit(digits)) return null

    return new Ean(digits, digits.padStart(KEY_WIDTH, '0'))
  }

  equals(other: Ean): boolean {
    return this.gtin14 === other.gtin14
  }
}

/**
 * GS1 modulo-10: weight the payload digits 3 and 1 alternately starting from
 * the rightmost one, then the check digit is whatever takes the sum to a
 * multiple of ten.
 *
 * Weighting from the right is what makes the key stable under left-padding —
 * the added zeros contribute nothing and every other digit keeps its weight,
 * so an EAN-13 and the same code as GTIN-14 both verify.
 *
 * Complexity: O(d), no allocation.
 */
function hasValidCheckDigit(digits: string): boolean {
  const lastIndex = digits.length - 1
  let sum = 0

  for (let i = lastIndex - 1; i >= 0; i -= 1) {
    const weight = (lastIndex - i) % 2 === 1 ? 3 : 1
    sum += (digits.charCodeAt(i) - 48) * weight
  }

  const expected = (10 - (sum % 10)) % 10
  return expected === digits.charCodeAt(lastIndex) - 48
}

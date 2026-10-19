import { normalizeText } from '../text/normalizeText'
import { KNOWN_UNIT_SPELLINGS, Quantity } from '../value-objects/Quantity'

const NUMBER = String.raw`\d+(?:[.,]\d+)?`

/**
 * The unit spellings come from Quantity, so there is one list rather than
 * two that can drift apart. Longest first, or "l" matches inside "ml".
 */
const UNIT = KNOWN_UNIT_SPELLINGS.join('|')

/**
 * Stops a unit from matching the first letter of the next word: in "Tipo 1
 * Lata" the L is not litres, while in "1 Litro" it is.
 */
const NOT_INSIDE_A_WORD = String.raw`(?![\p{L}])`

const MULTIPACK = new RegExp(
  String.raw`(\d+)\s*[x×]\s*(${NUMBER})\s*(${UNIT})${NOT_INSIDE_A_WORD}`,
  'giu',
)

const SINGLE_SIZE = new RegExp(String.raw`(${NUMBER})\s*(${UNIT})${NOT_INSIDE_A_WORD}`, 'giu')

/**
 * Reads what a store catalogue puts in a product name.
 *
 * Catalogue names are the only size information many stores give, and they
 * are written by whoever keyed the product in: "5kg", "500 g", "6x350ml",
 * "1 Litro". Getting the size right is what makes price-per-unit possible,
 * and price-per-unit is the number that actually answers "which is cheaper".
 *
 * Stateless, so one instance is safely shared.
 */
export class ProductNameParser {
  /**
   * Extracts the package size, or null when the name does not carry one.
   *
   * Two heuristics, both earned from real catalogue data:
   *  - the *last* size in the name wins, because grading and type numbers
   *    come first ("Arroz Tipo 1 5kg");
   *  - a multipack beats the single size inside it, because "6x350ml" is
   *    what the shopper pays for, not 350ml.
   *
   * Complexity: O(n) over the name for each of the two scans, so O(n)
   * overall; space is O(m) in the number of size-like matches found.
   */
  extractSize(name: string): Quantity | null {
    const text = normalizeText(name)

    const packs = [...text.matchAll(MULTIPACK)]
    if (packs.length > 0) {
      const [, count, size, unit] = packs[packs.length - 1]
      return Quantity.fromMeasurement(Number(count) * toNumber(size), unit)
    }

    const sizes = [...text.matchAll(SINGLE_SIZE)]
    if (sizes.length > 0) {
      const [, size, unit] = sizes[sizes.length - 1]
      return Quantity.fromMeasurement(toNumber(size), unit)
    }

    return null
  }

  /**
   * Builds the text the search index is built on: name plus brand, with the
   * brand left off when the name already contains it.
   *
   * Complexity: O(n).
   */
  buildSearchText(name: string, brand: string | null | undefined): string {
    const base = normalizeText(name)
    const normalizedBrand = normalizeText(brand ?? '')
    if (!normalizedBrand || base.includes(normalizedBrand)) return base
    return `${base} ${normalizedBrand}`.trim()
  }

  /**
   * Calms down a brand the catalogue shouts, while leaving an acronym alone.
   *
   * A single short all-caps word is an acronym ("TNT", "3M"); anything with a
   * space in it is a name being shouted ("TIO JOAO").
   *
   * Complexity: O(n).
   */
  normalizeBrand(brand: string | null | undefined): string | null {
    const trimmed = (brand ?? '').trim()
    if (!trimmed) return null

    const isSingleWord = !/\s/.test(trimmed)
    const isAcronym = isSingleWord && trimmed.length <= 4 && trimmed === trimmed.toUpperCase()
    if (isAcronym) return trimmed

    return trimmed
      .split(/(\s+|-)/)
      .map((part) => {
        if (/^(\s+|-)$/.test(part)) return part
        // Short words and anything with a digit keep their own casing, so
        // "3D" and "144G" survive a brand that is otherwise shouted.
        if (part.length <= 2 || /\d/.test(part)) return part
        return part[0].toUpperCase() + part.slice(1).toLowerCase()
      })
      .join('')
  }
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'))
}

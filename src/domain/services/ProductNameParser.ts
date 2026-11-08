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
 * Mass and volume spellings only — no count words.
 *
 * The distinction matters for the pack guard below: "Caixa 1000g" is a
 * one-kilo box, so the digits are a size, while "Fardo 12 unidades" is
 * twelve of something, so they are a count.
 */
const MEASURE_UNIT = KNOWN_UNIT_SPELLINGS.filter((spelling) =>
  /^(kg|g|mg|ml|cl|l|lt|litro|litros)$/.test(spelling),
).join('|')

/**
 * A pack written in words, with the count after the noun: "Pack 6 Galões
 * 1,27l Cada", "Caixa 12 Latas 350ml", "Fardo 12 Unidades 269ml".
 *
 * Wholesale clubs sell these alongside everyone else's single unit, and
 * reading the per-item size as the package size makes the two look
 * comparable when they are not.
 *
 * The connector is optional because catalogues write it both ways, and
 * leaving it out is what let "Pack de 4 latas Red Bull 250ml" through as
 * a single can — which then attached to the real pack through a shared
 * barcode and advertised 9,99 against 35,96 as a saving.
 *
 * The count is capped at two digits and must not be followed by a unit,
 * which is what keeps "Caixa 1000g" from being read as a thousand boxes.
 */
const PACK_COUNT = new RegExp(
  String.raw`\b(?:pack|fardo|caixa|cx|engradado|c\/|leve)\s*(?:de|com)?\s*(\d{1,2})\b(?!\s*(?:${MEASURE_UNIT})${NOT_INSIDE_A_WORD})`,
  'iu',
)

/**
 * The same pack, written the other way round: the count last, carried by
 * the word for what is being counted. "Red Bull 250ml - 4 Latas", "Chá
 * Leão Caixa com 15 Sachês - 15g", "Queijo Gouda 6 Unidades 120g".
 *
 * Needs its own pattern because there is no pack noun in front to anchor
 * on — only the counted thing behind. Anchored on that noun rather than
 * on a bare number, so "Arroz Tipo 1 Pacote 5kg" stays one kilo bag and
 * not five.
 *
 * The container words are required in the plural, because in the singular
 * they are how a catalogue describes the packaging rather than count it:
 * "Vinho Porta 6 Garrafa 750ml" is one bottle of a wine whose brand ends
 * in a number, and it was being read as 4,5 litres. "un" and "unid" are
 * exempt — they are never a description, only ever a tally.
 */
const TRAILING_COUNT = new RegExp(
  String.raw`\b(\d{1,2})\s*(?:latas|unidades|unid|un|garrafas|saches|sachets|potes|pacotes|tabletes|barras)\b`,
  'iu',
)

/** Counts outside this range are not pack sizes. */
const MIN_PACK = 2
const MAX_PACK = 48

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
      const single = Quantity.fromMeasurement(toNumber(size), unit)

      // A size already counted in units is the count. "Sorvete Picolé Uva
      // 4 Unidades" is four of them, and multiplying by the pack it just
      // matched would make it sixteen.
      if (single === null || single.unit === 'un') return single

      return Quantity.fromMeasurement(toNumber(size) * packCount(text), unit)
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

/**
 * How many items the package holds when the name says so in words, or 1.
 *
 * Complexity: O(n) over the name.
 */
function packCount(text: string): number {
  // The pack noun first, because "Caixa com 15 Sachês - 15g" names the
  // package before it names what is in it; only then the other order.
  const match = text.match(PACK_COUNT) ?? text.match(TRAILING_COUNT)
  if (!match) return 1

  // Always an integer: both patterns match one or two digits.
  const count = Number(match[1])
  return count < MIN_PACK || count > MAX_PACK ? 1 : count
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'))
}

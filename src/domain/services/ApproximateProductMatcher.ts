import { normalizeText } from '../text/normalizeText'
import { KNOWN_UNIT_SPELLINGS, type Quantity } from '../value-objects/Quantity'

export type MatchCandidate = {
  id: string
  name: string
  size: Quantity | null
}

export type ApproximateMatch = {
  /** Dice coefficient over the descriptive words, 0 to 1. */
  score: number
  /** Whether the pair may be presented as the same product. */
  confident: boolean
}

/** Function words. They appear everywhere and say nothing about identity. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por',
  'em', 'no', 'na', 'ao', 'aos', 'um', 'uma', 'os', 'as', 'e', 'ou',
  'tipo', 'pacote', 'caixa', 'pct', 'cx', 'unidade', 'unidades',
])

/**
 * Words that change what the product *is*.
 *
 * These carry the whole difference between two otherwise identical names,
 * and token overlap alone scores such a pair as a match — "Coca-Cola 2L"
 * against "Coca-Cola Zero 2L" shares everything but the one word that
 * matters. So a disagreement here vetoes the match outright, whatever the
 * score says.
 */
const MODIFIERS: ReadonlySet<string> = new Set([
  'zero', 'diet', 'light', 'integral', 'desnatado', 'semidesnatado',
  'lactose', 'deslactosado', 'organico', 'branco', 'defumado',
  'apimentado', 'picante', 'infantil',
])

const UNIT_WORDS: ReadonlySet<string> = new Set(KNOWN_UNIT_SPELLINGS)

/**
 * Decides whether two products with no barcode are the same thing.
 *
 * Needed because some chains publish no GTIN at all — Tenda gives only an
 * internal SKU, Tauste's Magento schema has no barcode field — so without
 * this their prices can never join a comparison.
 *
 * It is deliberately hard to satisfy. A wrong merge quotes somebody the
 * price of a product they are not looking at, which is worse than showing no
 * comparison, so the rules are: the size must be identical, the descriptive
 * words must largely agree, and any disagreement on a meaning-changing word
 * vetoes the pair. Matches found this way are shown as equivalent, never as
 * the same listing.
 *
 * Stateless, so one instance is safely shared.
 */
export class ApproximateProductMatcher {
  /**
   * Dice coefficient a pair must reach. Tuned so that sharing only a
   * category word cannot pass: "Arroz Camil" against "Arroz Tio João"
   * scores 0.4.
   */
  static readonly CONFIDENCE_THRESHOLD = 0.6

  /**
   * Complexity: O(t) in the number of descriptive words, which is bounded by
   * the length of a product name.
   */
  compare(a: MatchCandidate, b: MatchCandidate): ApproximateMatch {
    // Size first: it is the cheapest check and the one that rules out most
    // pairs, and nothing below can rescue a mismatch.
    if (!a.size || !b.size || !a.size.equals(b.size)) {
      return { score: 0, confident: false }
    }

    const left = describingWords(a.name)
    const right = describingWords(b.name)
    const score = dice(left, right)

    if (disagreeOnMeaning(left, right)) {
      return { score, confident: false }
    }

    return { score, confident: score >= ApproximateProductMatcher.CONFIDENCE_THRESHOLD }
  }

  /**
   * Clusters candidates into sets that may be presented as one product.
   *
   * Bucketing by size first is what makes this affordable: comparing every
   * product against every other is O(n²) over the whole catalogue, while
   * comparing only within a size bucket is O(n + Σ m²) for buckets of size
   * m — and a catalogue spreads thinly across sizes, so the buckets stay
   * small.
   *
   * Products with no size are returned alone, since nothing could anchor a
   * match for them.
   */
  group(candidates: readonly MatchCandidate[]): MatchCandidate[][] {
    // Sorted so the output does not depend on the order rows arrived in.
    const ordered = [...candidates].sort((x, y) => x.id.localeCompare(y.id))

    const buckets = new Map<string, MatchCandidate[]>()
    const alone: MatchCandidate[][] = []

    for (const candidate of ordered) {
      if (!candidate.size) {
        alone.push([candidate])
        continue
      }
      const key = `${candidate.size.amount}:${candidate.size.unit}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(candidate)
      else buckets.set(key, [candidate])
    }

    const groups: MatchCandidate[][] = []
    for (const bucket of buckets.values()) {
      groups.push(...this.clusterWithinBucket(bucket))
    }

    return [...groups, ...alone]
  }

  /**
   * Greedy single-link clustering: each candidate joins the first existing
   * group it confidently matches, otherwise starts its own.
   *
   * Greedy rather than exhaustive because the input is already narrowed to
   * one size and the threshold is high, so chains of weak links — the usual
   * failure of single-link clustering — cannot form.
   */
  private clusterWithinBucket(bucket: readonly MatchCandidate[]): MatchCandidate[][] {
    const groups: MatchCandidate[][] = []

    for (const candidate of bucket) {
      const home = groups.find((group) =>
        group.some((member) => this.compare(member, candidate).confident),
      )
      if (home) home.push(candidate)
      else groups.push([candidate])
    }

    return groups
  }
}

/**
 * The words that actually describe the product: no function words, no sizes,
 * no units, nothing containing a digit.
 *
 * Digits go because they are almost always the size repeated ("5kg", "1"),
 * and a size that already matched adds nothing to the comparison.
 *
 * Complexity: O(n) in the name length.
 */
function describingWords(name: string): ReadonlySet<string> {
  const words = normalizeText(name).match(/[a-z0-9]+/g) ?? []

  return new Set(
    words.filter(
      (word) =>
        word.length > 1 &&
        !/\d/.test(word) &&
        !STOPWORDS.has(word) &&
        !UNIT_WORDS.has(word),
    ),
  )
}

/** True when one name carries a meaning-changing word the other does not. */
function disagreeOnMeaning(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const word of MODIFIERS) {
    if (a.has(word) !== b.has(word)) return true
  }
  return false
}

/** Dice coefficient: twice the shared words over the total. O(|a| + |b|). */
function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0

  let shared = 0
  for (const word of a) {
    if (b.has(word)) shared += 1
  }

  return (2 * shared) / (a.size + b.size)
}

import { normalizeText, stripInvisible } from '../text/normalizeText'

/**
 * Portuguese function words. They match nearly every product, so they cost a
 * predicate and buy no selectivity.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por',
  'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'um', 'uma',
  'os', 'as', 'ou',
])

/**
 * A validated product search.
 *
 * This is where a text box stops being an attack surface. The query is
 * bounded in length and in token count before it reaches the database,
 * because each token becomes a predicate and an unbounded count makes one
 * cheap request into an expensive scan. Tokens are alphanumeric runs, so no
 * SQL or ILIKE syntax survives tokenisation at all.
 *
 * Immutable.
 */
export class SearchQuery {
  /** Long enough for "leite condensado piracanjuba 395g". */
  static readonly MAX_LENGTH = 64

  /** Below this there is nothing selective to search for. */
  static readonly MIN_TOKEN_LENGTH = 2

  /** Each token is one predicate; this bounds the cost of a single request. */
  static readonly MAX_TOKENS = 6

  private constructor(
    readonly raw: string,
    readonly normalized: string,
    readonly tokens: readonly string[],
  ) {
    Object.freeze(this)
    Object.freeze(this.tokens)
  }

  /**
   * Returns null for anything not worth a round trip to the database.
   *
   * Over-long input is rejected, not truncated: truncating would quietly
   * search for something the shopper did not ask for.
   *
   * Complexity: O(n) in the input length, and the result holds at most
   * MAX_TOKENS tokens regardless of input.
   */
  static tryParse(input: string | null | undefined): SearchQuery | null {
    if (!input) return null
    if (input.length > SearchQuery.MAX_LENGTH) return null

    const normalized = normalizeText(stripInvisible(input))
    if (!normalized) return null

    const tokens = (normalized.match(/[a-z0-9]+/g) ?? [])
      .filter((token) => token.length >= SearchQuery.MIN_TOKEN_LENGTH)
      .filter((token) => !STOPWORDS.has(token))
      .slice(0, SearchQuery.MAX_TOKENS)

    if (tokens.length === 0) return null

    return new SearchQuery(input, normalized, tokens)
  }

  /**
   * Wraps a term for ILIKE with the wildcards escaped, so `%` and `_` typed
   * by a shopper stay literal instead of becoming operators. The query
   * itself is always parameterised; this is the layer below that.
   *
   * Complexity: O(n).
   */
  static likePattern(term: string): string {
    const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`)
    return `%${escaped}%`
  }
}

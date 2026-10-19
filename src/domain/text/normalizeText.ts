/**
 * Folds text down to a comparable form: no accents, no case, no repeated
 * whitespace. Shared by product matching and by search, which must agree —
 * if they normalise differently, a product can be stored under a key the
 * search can never produce.
 *
 * Complexity: O(n) in the length of the input.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Characters that are invisible on screen but still change a string: C0 and
 * C1 controls, the soft hyphen, zero-width spaces and joiners, bidi
 * overrides, the word joiner and the BOM.
 *
 * They turn up in pasted text and in hand-crafted input probing the search
 * field, where they can smuggle a payload past a naive length or equality
 * check. Written as escapes because the literal characters would be
 * invisible here too.
 */
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\ufeff]/g

/**
 * Replaces invisible characters with a plain space, so they separate words
 * instead of silently joining them.
 *
 * Complexity: O(n).
 */
export function stripInvisible(input: string): string {
  return input.replace(INVISIBLE, ' ')
}

/** Cookie name. Read during server rendering, so the first paint is already regional. */
export const PREFERENCES_COOKIE = 'precinho_ctx'

/** A year: long enough that nobody re-enters their CEP, short enough to expire. */
export const PREFERENCES_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * How many stores one visitor may have picked.
 *
 * The list goes straight into a query predicate, so an unbounded array from
 * a hand-edited cookie is a way to make one request expensive.
 */
export const MAX_PICKED_STORES = 40

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Which shops the visitor wants compared.
 *
 * Only that, now. It used to carry a postcode and a region as well, from
 * when a visitor had to say where they were; there is one covered area
 * and the screens name it, so the question is gone and so is the answer.
 *
 * Kept in a cookie rather than the database. There is no login, so there
 * is nobody for a stored preference to belong to — and a cookie is
 * readable during server rendering, where localStorage is not, so the
 * first paint already shows the right shops instead of correcting itself.
 */
export type ShoppingPreferences = {
  storeIds: readonly string[]
}

export function serializePreferences(preferences: ShoppingPreferences): string {
  return JSON.stringify({ stores: preferences.storeIds })
}

/**
 * Parses the cookie, returning null for anything that is not a usable
 * preference.
 *
 * The cookie is user-controlled: it can be hand-edited, left over from an
 * older format, or deliberately malformed. Nothing here trusts it — ids are
 * checked against the uuid shape before they can reach a query, and the
 * store list is capped. A bad cookie means the shopper is asked for their
 * CEP again, which is a far better outcome than a broken page.
 *
 * Complexity: O(s) in the number of stored store ids, itself capped.
 */
export function parsePreferences(raw: string | undefined | null): ShoppingPreferences | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const candidate = parsed as Record<string, unknown>

  if (!Array.isArray(candidate.stores)) return null
  const storeIds = candidate.stores
    .filter((id): id is string => typeof id === 'string' && UUID.test(id))
    .slice(0, MAX_PICKED_STORES)

  return { storeIds }
}

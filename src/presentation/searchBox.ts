/**
 * What the search box should hold, given where the browser is.
 *
 * The box is typed into, so its contents are state; but the browser can
 * move underneath it — the back button, a link, a redirect — and then the
 * box is showing a term belonging to a page the reader has left. Pressing
 * back from /busca?q=cafe to /busca?q=detergente left "cafe" in the box,
 * and pressing back again to the home page left "detergente" there. Hit
 * enter without noticing and the app searches something you looked at two
 * pages ago, which is exactly what it was reported doing.
 *
 * Extracted from the component because it is a rule rather than a
 * rendering concern, and because the component cannot be tested here: the
 * suite runs in node with no DOM. Every visual fault in this project so
 * far has been found by a person rather than by a test, so logic that can
 * be pulled out of a screen should be.
 */
export type SearchBoxState = {
  /** What is in the box. */
  typed: string
  /** The URL query that value was last reconciled against. */
  fromUrl: string
}

export function emptySearchBox(urlQuery: string): SearchBoxState {
  return { typed: urlQuery, fromUrl: urlQuery }
}

/**
 * Follows the URL when it changes, and otherwise leaves typing alone.
 *
 * The comparison is against the query last reconciled, not against what is
 * in the box: comparing with `typed` would wipe out half-typed input every
 * time the component re-rendered.
 *
 * Complexity: O(1).
 */
export function reconcileSearchBox(state: SearchBoxState, urlQuery: string): SearchBoxState {
  if (urlQuery === state.fromUrl) return state

  return { typed: urlQuery, fromUrl: urlQuery }
}

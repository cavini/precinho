'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { SearchQuery } from '@/domain/value-objects/SearchQuery'
import { emptySearchBox, reconcileSearchBox } from '../searchBox'

/**
 * The product search box.
 *
 * Checks the query against the same SearchQuery the server uses, so a query
 * the server would reject never leaves the browser, and the maxLength is the
 * domain's own limit rather than a number copied into the markup.
 *
 * While a search is in flight the button is disabled and says so. Two
 * reasons, and the second is the one that bites: a second press fires a
 * second navigation, and on a cold start the first can take seconds with
 * nothing on screen to say anything is happening.
 *
 * The box follows the address bar. React keeps this component mounted
 * across client navigations, so without that it goes on showing a term
 * from a page the reader has left — back from ?q=cafe to ?q=detergente
 * left "cafe" sitting in the box, ready to be searched again by anybody
 * who pressed enter without looking.
 */
export function SearchForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  // The navigation is a server render — the results are fetched before
  // the new page arrives — so a plain flag would clear itself long
  // before anything appeared on screen. A transition stays pending for
  // exactly as long as the search takes.
  const [searching, startSearching] = useTransition()
  const urlQuery = params.get('q') ?? ''
  const [box, setBox] = useState(() => emptySearchBox(urlQuery))

  // Adjusted during render rather than in an effect, which is React's own
  // answer to "reset state when something outside changes": an effect would
  // paint the stale term first and correct it a frame later.
  const reconciled = reconcileSearchBox(box, urlQuery)
  if (reconciled !== box) setBox(reconciled)

  const value = reconciled.typed
  const usable = SearchQuery.tryParse(value) !== null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!usable || searching) return

    // Awaited inside the transition so the pending state covers the
    // whole navigation. The push itself is what suspends — React keeps
    // the transition pending until the new route has rendered — and the
    // await only makes that observable to a caller holding a promise.
    startSearching(async () => {
      await router.push(`/busca?q=${encodeURIComponent(value)}`)
    })
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2">
      <input
        value={value}
        onChange={(event) => setBox({ ...reconciled, typed: event.target.value })}
        maxLength={SearchQuery.MAX_LENGTH}
        autoFocus={autoFocus}
        placeholder="arroz, leite condensado, coca 2L…"
        aria-label="Buscar produto"
        className="flex-1 rounded-xl border border-rule-strong bg-surface px-4 py-3 text-ink
 outline-none focus:border-ink"
      />
      <button
        type="submit"
        disabled={!usable || searching}
        aria-busy={searching}
        className="flex items-center gap-2 rounded-xl bg-ink px-5 py-3 font-medium text-surface disabled:opacity-40"
      >
        {searching && <Spinner />}
        {searching ? 'Buscando' : 'Buscar'}
      </button>
    </form>
  )
}

/**
 * Drawn rather than imported: one spinner does not justify a dependency,
 * and an inline SVG inherits the button's colour instead of fighting it.
 */
function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4 animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

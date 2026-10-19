'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { SearchQuery } from '@/domain/value-objects/SearchQuery'

/**
 * The product search box.
 *
 * Checks the query against the same SearchQuery the server uses, so a query
 * the server would reject never leaves the browser, and the maxLength is the
 * domain's own limit rather than a number copied into the markup.
 */
export function SearchForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get('q') ?? '')

  const usable = SearchQuery.tryParse(value) !== null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!usable) return
    router.push(`/busca?q=${encodeURIComponent(value)}`)
  }

  return (
    <form onSubmit={submit} className="flex w-full gap-2">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={SearchQuery.MAX_LENGTH}
        autoFocus={autoFocus}
        placeholder="arroz, leite condensado, coca 2L…"
        aria-label="Buscar produto"
        className="flex-1 rounded-xl border border-rule-strong bg-surface px-4 py-3 text-ink
 outline-none focus:border-ink"
      />
      <button
        type="submit"
        disabled={!usable}
        className="rounded-xl bg-ink px-5 py-3 font-medium text-surface disabled:opacity-40"
      >
        Buscar
      </button>
    </form>
  )
}

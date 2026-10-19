'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ShoppingContextStore } from '@/application/use-cases/ResolveShoppingContext'
import { writePreferencesCookie } from '../preferencesCookie'

type Props = {
  stores: readonly ShoppingContextStore[]
  picked: readonly string[]
  postalCode: string
  regionId: string
}

/**
 * Which chains to compare.
 *
 * Most people shop at four or five places, not at every chain in the city,
 * and a comparison against stores they will never visit is noise. Narrowing
 * also makes the query cheaper, since the picked ids are what the search
 * filters on.
 *
 * Toggling writes the cookie directly. The server reads it on the next
 * render, but setting it needs no round trip, so the chips respond at once
 * and the page refreshes behind them.
 */
export function StorePicker({ stores, picked, postalCode, regionId }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<readonly string[]>(picked)

  function apply(storeIds: readonly string[]) {
    setSelected(storeIds)
    writePreferencesCookie({ postalCode, regionId, storeIds })
    router.refresh()
  }

  function toggle(storeId: string) {
    apply(
      selected.includes(storeId) ? selected.filter((id) => id !== storeId) : [...selected, storeId],
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-ink-soft">Comparar em</span>

      {stores.map((store) => {
        const on = selected.includes(store.id)
        return (
          <button
            key={store.id}
            type="button"
            onClick={() => toggle(store.id)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              on ? 'border-ink bg-ink text-surface' : 'border-rule-strong text-ink-soft'
            }`}
          >
            {store.name}
          </button>
        )
      })}

      {selected.length !== stores.length && (
        <button
          type="button"
          onClick={() => apply(stores.map((store) => store.id))}
          className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          marcar todos
        </button>
      )}

      {selected.length === 0 && (
        <span className="text-sm text-warn">Escolha pelo menos um mercado.</span>
      )}
    </div>
  )
}

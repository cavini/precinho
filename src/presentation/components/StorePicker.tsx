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
 * Most people shop at four or five places, not every chain in the city, and
 * a comparison against stores they will never visit is noise. Narrowing also
 * makes the query cheaper, since the picked ids are what the search filters
 * on.
 *
 * Selection is shown with a green check rather than by inverting the chip.
 * Filled-versus-outline reads as two different kinds of button rather than
 * as on and off, and with ten chips on screen the whole row became a wall of
 * black boxes. A check is the one mark nobody has to learn.
 *
 * Toggling writes the cookie directly: the server reads it on the next
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
      selected.includes(storeId)
        ? selected.filter((id) => id !== storeId)
        : [...selected, storeId],
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-ink-faint">Comparar em</span>

      {stores.map((store) => {
        const on = selected.includes(store.id)
        return (
          <button
            key={store.id}
            type="button"
            onClick={() => toggle(store.id)}
            aria-pressed={on}
            className={`flex items-center gap-1.5 rounded-full border bg-surface py-1 pl-2 pr-3 text-sm transition-colors ${
              on ? 'border-rule-strong text-ink' : 'border-rule text-ink-faint'
            }`}
          >
            {/* Always rendered, so toggling does not shift the row. */}
            <CheckMark visible={on} />
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

/** Keeps its space when hidden, so the chips do not jump as you toggle. */
function CheckMark({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 shrink-0 ${visible ? 'text-accent' : 'text-transparent'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

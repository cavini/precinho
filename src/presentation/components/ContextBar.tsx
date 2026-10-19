'use client'

import { useState } from 'react'
import type { ShoppingContextStore } from '@/application/use-cases/ResolveShoppingContext'
import { PostalCodeForm } from './PostalCodeForm'
import { StorePicker } from './StorePicker'

type Props = {
  postalCodeLabel: string
  regionId: string
  stores: readonly ShoppingContextStore[]
  picked: readonly string[]
}

/**
 * Where the shopper is, and which stores they are comparing.
 *
 * Both sit at the top of every page because both change every price below
 * them. Hiding either would leave somebody reading prices for a city or a
 * chain they did not choose.
 */
export function ContextBar({ postalCodeLabel, regionId, stores, picked }: Props) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Preços para o CEP</span>
        <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
          {postalCodeLabel}
        </span>

        {editing ? (
          <PostalCodeForm current={postalCodeLabel} onDone={() => setEditing(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            trocar
          </button>
        )}
      </div>

      <StorePicker
        stores={stores}
        picked={picked}
        postalCode={postalCodeLabel.replace(/\D/g, '')}
        regionId={regionId}
      />
    </div>
  )
}

'use client'

import type { ShoppingContextStore } from '@/application/use-cases/ResolveShoppingContext'
import { StorePicker } from './StorePicker'

type Props = {
  /** The covered area, named as the database holds it. */
  regionName: string
  stores: readonly ShoppingContextStore[]
  picked: readonly string[]
}

/**
 * Where these prices are from, and which shops are being compared.
 *
 * The place is stated rather than asked for. One area is collected, and
 * somebody reading a price is owed the knowledge of where it applies —
 * a visitor from elsewhere should be able to tell at a glance that this
 * is not for them, without typing a postcode to find out.
 */
export function ContextBar({ regionName, stores, picked }: Props) {
  return (
    <div className="flex flex-col gap-3 border-b border-rule pb-4">
      <p className="text-sm text-ink-soft">
        Preços dos mercados de <span className="font-medium text-ink">{regionName}</span>
      </p>

      <StorePicker stores={stores} picked={picked} />
    </div>
  )
}

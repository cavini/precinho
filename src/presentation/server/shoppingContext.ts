import { cache } from 'react'
import { cookies } from 'next/headers'
import type { ShoppingContextStore } from '@/application/use-cases/ResolveShoppingContext'
import { getWebContainer } from '@/composition/container'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { PREFERENCES_COOKIE, parsePreferences } from '../preferences'

/** What every page needs to know before it can show a price. */
export type PageContext =
  | {
      status: 'ready'
      postalCodeLabel: string
      regionId: string
      stores: readonly ShoppingContextStore[]
      /** The stores the shopper picked, in the region's order. */
      pickedStoreIds: readonly string[]
    }
  /** No usable cookie: the shopper has not told us where they are. */
  | { status: 'needs-postal-code' }

/**
 * Reads the shopping context for a server-rendered page.
 *
 * This is why the preference is a cookie and not localStorage: the region is
 * known before the first byte is sent, so a page renders with the right
 * prices instead of flashing a CEP prompt and then correcting itself.
 *
 * Complexity: O(s) over the region's stores, one query.
 */
export const readPageContext = cache(async function readPageContext(): Promise<PageContext> {
  const store = await cookies()
  const preferences = parsePreferences(store.get(PREFERENCES_COOKIE)?.value)

  if (!preferences) return { status: 'needs-postal-code' }

  const stores = await getWebContainer().listRegionStores.execute(preferences.regionId)
  if (stores.length === 0) {
    // The region went away or has no active stores; asking again is better
    // than rendering an empty comparison with no explanation.
    return { status: 'needs-postal-code' }
  }

  const known = new Set(stores.map((candidate) => candidate.id))

  return {
    status: 'ready',
    postalCodeLabel: PostalCode.tryParse(preferences.postalCode)?.formatted ?? '',
    regionId: preferences.regionId,
    stores,
    // Filtered against the region, so a store that closed or moved cannot
    // sit in a cookie forever narrowing somebody's results invisibly.
    pickedStoreIds: preferences.storeIds.filter((id) => known.has(id)),
  }
})

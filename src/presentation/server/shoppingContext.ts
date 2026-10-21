import { cache } from 'react'
import { cookies } from 'next/headers'
import type { ShoppingContextStore } from '@/application/use-cases/ResolveShoppingContext'
import { getWebContainer } from '@/composition/container'
import { PREFERENCES_COOKIE, parsePreferences } from '../preferences'

/** What every page needs to know before it can show a price. */
export type PageContext =
  | {
      status: 'ready'
      /** The covered area, named as the screens should name it. */
      regionName: string
      regionId: string
      stores: readonly ShoppingContextStore[]
      /** The stores the shopper picked, in the region's order. */
      pickedStoreIds: readonly string[]
    }
  /** Nothing is being collected anywhere, so there is nothing to show. */
  | { status: 'no-coverage' }

/**
 * Reads the shopping context for a server-rendered page.
 *
 * The covered area is wherever shops are being collected, read from the
 * database rather than written here: the screens name the place, and the
 * code does not have to know which place it is.
 *
 * A visitor is not asked where they are. There is one covered area and
 * the screens say so, which answers the question a postcode used to —
 * and answers it before somebody types anything, rather than after.
 *
 * The cookie now carries only which shops they want compared. Anyone
 * arriving without one gets all of them, because a visitor who has
 * expressed no preference wants the full comparison, while a visitor
 * who cleared the picker meant to clear it.
 *
 * Complexity: one query for the region, one for its stores.
 */
export const readPageContext = cache(async function readPageContext(): Promise<PageContext> {
  const area = await getWebContainer().getCoveredArea.execute()
  if (!area) return { status: 'no-coverage' }

  const cookieStore = await cookies()
  const preferences = parsePreferences(cookieStore.get(PREFERENCES_COOKIE)?.value)
  const known = new Set(area.stores.map((store) => store.id))

  // Filtered against the region, so a shop that closed cannot sit in a
  // cookie forever narrowing somebody's results invisibly.
  const picked = preferences?.storeIds.filter((id) => known.has(id))

  return {
    status: 'ready',
    regionName: area.regionName,
    regionId: area.regionId,
    stores: area.stores,
    pickedStoreIds: picked && picked.length > 0 ? picked : [...known],
  }
})

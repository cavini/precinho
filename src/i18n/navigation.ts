import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Navigation that knows which language it is in.
 *
 * Everything that moves between pages has to come from here rather than
 * from `next/link` and `next/navigation`: these are what keep the reader
 * in their language across a click, and what translate the app's own
 * `/search` into the `/busca` or `/en/search` that belongs in the address
 * bar. A plain `next/link` would drop an English reader back into
 * Portuguese at the first link they followed.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)

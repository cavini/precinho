import createProxy from 'next-intl/middleware'
import { routing } from './i18n/routing'

/**
 * Decides which language a request is for, before anything renders.
 *
 * Reads the prefix when there is one, and otherwise the locale cookie
 * next-intl keeps when a reader switches — so somebody who chose English
 * and then opens a bare `/` lands in English rather than being quietly
 * reset.
 */
export default createProxy(routing)

export const config = {
  // Everything except the API, Next's own assets, and anything with a file
  // extension. The API answers with data rather than sentences, so it has
  // no language to negotiate and no business paying for this.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
}

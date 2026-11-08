import { defineRouting } from 'next-intl/routing'

/**
 * Where each language lives.
 *
 * Portuguese keeps the bare paths it has always had and English is
 * prefixed — `localePrefix: 'as-needed'`. Every link anybody has already
 * shared goes on working, and the language a page is in is now something
 * a URL can say, which a cookie never could: a link sent to somebody
 * arrives in the language it was sent in, and a search engine can index
 * both instead of guessing which one it was served.
 *
 * The route folders are English because the code is English. The paths
 * are not, because a path is read by the person in the address bar: a
 * Brazilian shopper gets `/busca`, and the same route is `/en/search`.
 * `pathnames` is what keeps those two facts from fighting — the app
 * refers to `/search` everywhere and next-intl writes whichever spelling
 * the reader's language uses.
 */
export const routing = defineRouting({
  locales: ['pt', 'en'],
  defaultLocale: 'pt',
  localePrefix: 'as-needed',
  pathnames: {
    '/': '/',
    '/search': { pt: '/busca', en: '/search' },
    '/product/[id]': { pt: '/produto/[id]', en: '/product/[id]' },
  },
})

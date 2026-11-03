import * as rootParams from 'next/root-params'
import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

/**
 * Where next-intl gets the language and the words for it.
 *
 * Resolved from the URL. Taking it from the route segment rather than
 * from a request header keeps it available inside `use cache`, which a
 * cookie read never is — every page here is partially prerendered, so
 * that mattered more than it looks.
 *
 * Falls back rather than 404s on an unknown segment: next-intl's proxy
 * only ever routes the locales above, so anything else arriving here is a
 * direct render, and the default language is a better answer than a
 * missing page.
 */
export default getRequestConfig(async ({ locale }) => {
  const requested = locale ?? (await rootParams.locale())
  const resolved = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale

  return {
    locale: resolved,
    messages: (await import(`../../messages/${resolved}.json`)).default,
  }
})

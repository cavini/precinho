import type { ReactNode } from 'react'
import { type Locale, NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import pt from '../../messages/pt.json'
import { routing } from '@/i18n/routing'

const MESSAGES = { pt, en }

/**
 * Renders a client component the way a page does.
 *
 * `useTranslations` needs a provider, and in the app that provider sits in
 * each page's dynamic body with messages resolved from the cookie. A test
 * has no request, so it says which language it means and gets the real
 * message file — not a stub, so a test that passes is one the shipped
 * sentences pass.
 */
export function inLanguage(ui: ReactNode, language: Locale = routing.defaultLocale) {
  return (
    <NextIntlClientProvider locale={language} messages={MESSAGES[language]}>
      {ui}
    </NextIntlClientProvider>
  )
}

import type messages from './messages/pt.json'
import type { routing } from './src/i18n/routing'

/**
 * Teaches next-intl what this app's languages and messages are.
 *
 * Without it `t('Feed.headnig')` is a runtime fallback that ships a key
 * where a sentence should be. With it the compiler refuses the typo, and
 * refuses a locale that is not one of ours.
 *
 * Typed from the Portuguese because that is the default and so the one
 * next-intl falls back to; messages.test.ts is what holds English to the
 * same shape.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number]
    Messages: typeof messages
  }
}

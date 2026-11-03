import type { Locale } from 'next-intl'

/**
 * How each language names itself.
 *
 * Not translated, on purpose, and one of the two bits of interface text
 * that stay out of the message files. Somebody who cannot read the page
 * they landed on still has to find their own language in the list, and
 * "Português" is the word they are looking for whatever the rest of the
 * page currently says. The other is "Precinho", which is a name.
 */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  pt: 'Português',
  en: 'English',
}

/**
 * The BCP 47 tag each language renders as.
 *
 * The locale itself is the short id, because it is what a URL segment and
 * a message file are named after and `/pt-BR/search` reads badly. This is
 * for the two places that format rather than translate: the lang
 * attribute, which tells a screen reader which phonemes to use, and the
 * collection date on a product page.
 *
 * Portuguese gets the Brazilian region because that is whose Portuguese
 * this is. English gets none: nothing here is written for one
 * English-speaking country over another.
 */
export const LOCALE_TAG: Record<Locale, string> = {
  pt: 'pt-BR',
  en: 'en',
}

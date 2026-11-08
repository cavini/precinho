'use client'

import { useParams } from 'next/navigation'
import { useTransition } from 'react'
import { type Locale, useLocale, useTranslations } from 'next-intl'
import { LANGUAGE_NAMES } from '@/i18n/config'
import { usePathname, useRouter } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

/**
 * Which language the interface speaks.
 *
 * Only the interface. The shops, the covered area and the prices are the
 * same either way — this is not a currency switch and not a region
 * switch, and nothing it does changes what is being compared.
 *
 * Shown as two words rather than as a flag: a flag is a country and this
 * is a language, and the two have never mapped onto each other. The
 * current one reads as a label and the other as a link.
 *
 * Carries its own size and colour rather than inheriting them, because it
 * sits beside the site's name in the header where the surrounding type is
 * three steps larger. A control for changing the language should be
 * findable and quiet, not loud.
 *
 * It navigates rather than setting a preference. The language is part of
 * the address now, so switching it is a move to the same page in the
 * other language — which is also what makes the result shareable: the
 * link in the bar afterwards is a link to what is on screen.
 */
export function LanguageToggle() {
  const t = useTranslations('Header')
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  // The switch is a server render, so the words arrive with the new page
  // rather than before it. The transition is what lets the control say it
  // is working for exactly as long as that takes.
  const [switching, startSwitching] = useTransition()

  function pick(next: Locale) {
    if (next === locale || switching) return

    // Read here rather than through useSearchParams, which is a dynamic
    // hook: subscribing to the query would have made this control — and
    // so the header it sits in, and so the prerendered shell of every
    // page — wait for a request. The term is only wanted at the moment
    // of the press, and at that moment the address bar has it.
    const query = Object.fromEntries(new URLSearchParams(window.location.search))

    startSwitching(() => {
      // `pathname` comes back without the prefix and with the dynamic
      // segments still in it, so a product's id survives the switch and
      // `params` fills it back in. The query rides along separately,
      // because a search term is not part of the route.
      router.replace(
        // @ts-expect-error -- The typed router proves that a pathname is
        // only given the params that pathname declares. It cannot prove
        // it here, where the pathname is whichever route we happen to be
        // on; the two always agree, because both describe the page that
        // is already on screen.
        { pathname, params, query },
        { locale: next },
      )
    })
  }

  return (
    <div
      role="group"
      aria-label={t('language')}
      aria-busy={switching}
      className="flex shrink-0 items-center divide-x divide-rule text-xs text-ink-soft"
    >
      {routing.locales.map((option) => {
        const on = option === locale
        return (
          <button
            key={option}
            type="button"
            onClick={() => pick(option)}
            aria-pressed={on}
            className={`px-2 first:pl-0 last:pr-0 ${
              on ? 'font-medium text-ink' : 'underline underline-offset-2 hover:text-ink'
            } ${switching ? 'opacity-60' : ''}`}
          >
            {LANGUAGE_NAMES[option]}
          </button>
        )
      })}
    </div>
  )
}

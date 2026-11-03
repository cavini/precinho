import { Suspense } from 'react'
import type { Metadata } from 'next'
import { locale as rootLocale } from 'next/root-params'
import { type Locale, NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { coverageUnreadable } from '@/application/use-cases/GetCoveredArea'
import { getWebContainer } from '@/composition/container'
import { LOCALE_TAG } from '@/i18n/config'
import { Link } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'
import { LanguageToggle } from '@/presentation/components/LanguageToggle'
import { LanguageSkeleton } from '@/presentation/components/Skeletons'
import '../globals.css'

/**
 * The language of the route being rendered.
 *
 * A root parameter rather than a prop, so it is readable from anywhere on
 * the server — including inside `use cache`, which is what lets the title
 * below be both translated and cached. Narrowed rather than trusted: the
 * segment is a string until something checks it.
 */
async function requestedLocale(): Promise<Locale> {
  const requested = await rootLocale()
  return hasLocale(routing.locales, requested) ? requested : routing.defaultLocale
}

/** Both languages are built, so neither waits on a request to exist. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

/**
 * Named after wherever is being collected, read rather than written here.
 *
 * The title is the first thing a search result or a shared link shows, and
 * it has one job: somebody who is not near these shops should be able to
 * tell before they click. Taking the name from the database keeps that
 * true if the covered area ever changes, and keeps the place out of the
 * source.
 *
 * In the reader's language now, which it could not be while the language
 * lived in a cookie: the title would have had to be either dynamic or
 * shared, and a shared title cannot be in two languages. The locale is a
 * route parameter, so it survives into `use cache` and this stays one
 * cached title per language rather than one per request.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Cached, because the covered area changes about as often as a region
  // is opened and the title is otherwise read on every request — and
  // without this the whole tree turns dynamic, 404 included.
  'use cache'

  const t = await getTranslations({ locale: await requestedLocale(), namespace: 'Metadata' })

  // The covered area, not the visitor's context: a title that read a
  // cookie would make every page dynamic, including the 404 that has
  // nothing to render for anybody.
  const area = await getWebContainer().getCoveredArea.execute()

  if (!area || coverageUnreadable(area)) {
    return { title: 'Precinho', description: t('genericDescription') }
  }

  return {
    title: t('title', { region: area.regionName }),
    description: t('description', { region: area.regionName }),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestedLocale()

  return (
    // The tag comes from the route now, so it is right in the markup
    // itself rather than corrected by a script after the fact.
    //
    // Browser extensions write their own attributes onto <html> before
    // React hydrates — a dark-mode one adds nighteye="disabled" — and
    // React reports that as a hydration mismatch in our code. Suppressed
    // on this node only, so a real mismatch anywhere inside still shows up.
    <html lang={LOCALE_TAG[locale]} suppressHydrationWarning>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        {/* One provider for the whole tree, which is where next-intl
            wants it and where it could not go while the language came
            from a cookie: resolving it there would have cost every
            segment below the layout its prerendered shell. */}
        <NextIntlClientProvider>
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
            {/* The switch lives up here, not in the footer. Two of these
                three screens scroll forever: reaching for a control at
                the bottom of a feed that grows as you approach it is a
                control nobody can reach. Scrolling back up is one
                gesture. */}
            <header className="flex items-baseline justify-between gap-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Precinho
              </Link>

              {/* Its own boundary, and the only thing in the chrome that
                  needs one. To offer "the same page in the other
                  language" the switch has to know which page it is on,
                  and on a product that is the id in the address — request
                  data, which the shell by definition does not have. The
                  name beside it stays static, and this lands in a
                  fallback of its own width so nothing shifts. */}
              <Suspense fallback={<LanguageSkeleton />}>
                <LanguageToggle />
              </Suspense>
            </header>

            <main className="flex flex-col gap-6">{children}</main>

            <footer className="border-t border-rule pt-4 text-xs text-ink-soft">
              <Disclaimer />
            </footer>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

/**
 * The one sentence of chrome with words in it.
 *
 * Nothing waits on it any more. It used to sit behind its own Suspense
 * boundary because reading the language meant reading a cookie; the
 * language is part of the route now, so this is as static as the rule
 * above it.
 */
async function Disclaimer() {
  const t = await getTranslations('Footer')

  return <p>{t('disclaimer')}</p>
}

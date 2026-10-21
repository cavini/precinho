import type { Metadata } from 'next'
import Link from 'next/link'
import { getWebContainer } from '@/composition/container'
import './globals.css'

/**
 * Named after wherever is being collected, read rather than written here.
 *
 * The title is the first thing a search result or a shared link shows, and
 * it has one job: somebody who is not near these shops should be able to
 * tell before they click. Taking the name from the database keeps that
 * true if the covered area ever changes, and keeps the place out of the
 * source.
 */
export async function generateMetadata(): Promise<Metadata> {
  // Cached, because the covered area changes about as often as a region
  // is opened and the title is otherwise read on every request — and
  // without this the whole tree turns dynamic, 404 included.
  'use cache'

  // The covered area, not the visitor's context: a title that read the
  // cookie would make every page dynamic, including the 404 that has
  // nothing to render for anybody.
  const area = await getWebContainer().getCoveredArea.execute()

  if (!area) {
    return { title: 'Precinho', description: 'Comparador de preços de mercado.' }
  }

  return {
    title: `Precinho — os melhores preços em ${area.regionName}`,
    description:
      `Compare o preço dos produtos de mercado nas redes de ${area.regionName}, ` +
      'com link direto pra loja.',
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions write their own attributes onto <html> before React
    // hydrates — a dark-mode one adds nighteye="disabled" — and React reports
    // that as a hydration mismatch in our code. Suppressed on this node only,
    // so a real mismatch anywhere inside still shows up.
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          <header>
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Precinho
            </Link>
          </header>

          <main className="flex flex-col gap-6">{children}</main>

          <footer className="border-t border-rule pt-4 text-xs text-ink-soft">
            Preços coletados dos sites das próprias redes. Confirme no site da loja antes de
            comprar.
          </footer>
        </div>
      </body>
    </html>
  )
}

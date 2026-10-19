import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Precinho — onde o mercado está mais barato',
  description:
    'Compare o preço dos produtos de mercado nas redes que você usa, pelo seu CEP, com link direto pra loja.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
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

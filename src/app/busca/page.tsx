import { headers } from 'next/headers'
import Link from 'next/link'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { PostalCodeGate } from '@/presentation/components/PostalCodeGate'
import { ResultList } from '@/presentation/components/ResultList'
import { SearchForm } from '@/presentation/components/SearchForm'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

/**
 * Rendered per request, never prerendered.
 *
 * Every price on this page depends on the visitor's CEP and the stores they
 * picked, both of which come from their cookie, and the rate limiter needs
 * their request headers. There is no region-neutral version of this page to
 * cache, so blocking is the honest setting rather than a performance
 * oversight.
 */
export const instant = false

type Props = {
  searchParams: Promise<{ q?: string }>
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = '' } = await searchParams
  const context = await readPageContext()

  if (context.status === 'needs-postal-code') {
    return <PostalCodeGate />
  }

  const bar = (
    <ContextBar
      postalCodeLabel={context.postalCodeLabel}
      regionId={context.regionId}
      stores={context.stores}
      picked={context.pickedStoreIds}
    />
  )

  const result = await getWebContainer().searchProducts.execute({
    rawQuery: q,
    regionId: context.regionId,
    storeIds: context.pickedStoreIds,
    clientKey: clientKeyFromHeaders(await headers()),
  })

  return (
    <>
      {bar}
      <SearchForm />

      {result.status === 'ok' && <ResultList query={q} items={result.items} />}

      {result.status === 'invalid-query' && (
        <Notice>Escreva pelo menos duas letras pra eu ter o que procurar.</Notice>
      )}

      {result.status === 'no-stores-selected' && (
        <Notice>Marque pelo menos um mercado ali em cima pra eu comparar.</Notice>
      )}

      {result.status === 'rate-limited' && (
        <Notice>Muitas buscas em pouco tempo. Tente de novo em {result.retryAfterSeconds}s.</Notice>
      )}

      <p className="text-sm text-ink-soft">
        <Link href="/" className="underline underline-offset-2">
          Voltar
        </Link>
      </p>
    </>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">{children}</p>
}

import { Suspense } from 'react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { PostalCodeGate } from '@/presentation/components/PostalCodeGate'
import { InfiniteResults } from '@/presentation/components/InfiniteResults'
import { SearchForm } from '@/presentation/components/SearchForm'
import { ContextBarSkeleton, ResultListSkeleton } from '@/presentation/components/Skeletons'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

type Props = {
  searchParams: Promise<{ q?: string }>
}

export default function SearchPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={
        <>
          <ContextBarSkeleton />
          <ResultListSkeleton />
        </>
      }
    >
      <SearchBody searchParams={searchParams} />
    </Suspense>
  )
}

async function SearchBody({ searchParams }: Props) {
  const { q = '' } = await searchParams
  const context = await readPageContext()

  if (context.status === 'needs-postal-code') {
    return <PostalCodeGate />
  }

  return (
    <>
      <ContextBar
        postalCodeLabel={context.postalCodeLabel}
        regionId={context.regionId}
        stores={context.stores}
        picked={context.pickedStoreIds}
      />
      <SearchForm />

      {/* Keyed on the query so typing a new one shows the skeleton again
          rather than leaving the previous results up while it loads. */}
      <Suspense key={q} fallback={<ResultListSkeleton />}>
        <Results query={q} regionId={context.regionId} storeIds={context.pickedStoreIds} />
      </Suspense>

      <p className="text-sm text-ink-soft">
        <Link href="/" className="underline underline-offset-2">
          Voltar
        </Link>
      </p>
    </>
  )
}

async function Results({
  query,
  regionId,
  storeIds,
}: {
  query: string
  regionId: string
  storeIds: readonly string[]
}) {
  const result = await getWebContainer().searchProducts.execute({
    rawQuery: query,
    regionId,
    storeIds,
    clientKey: clientKeyFromHeaders(await headers()),
  })

  if (result.status === 'ok') {
    return (
      <InfiniteResults query={query} initialItems={result.items} initialHasMore={result.hasMore} />
    )
  }

  return (
    <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
      {result.status === 'invalid-query' &&
        'Escreva pelo menos duas letras pra eu ter o que procurar.'}
      {result.status === 'no-stores-selected' &&
        'Marque pelo menos um mercado ali em cima pra eu comparar.'}
      {result.status === 'rate-limited' &&
        `Muitas buscas em pouco tempo. Tente de novo em ${result.retryAfterSeconds}s.`}
    </p>
  )
}

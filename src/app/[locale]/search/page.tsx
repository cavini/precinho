import { Suspense } from 'react'
import { RetryButton } from '@/presentation/components/RetryButton'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { Link } from '@/i18n/navigation'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { InfiniteResults } from '@/presentation/components/InfiniteResults'
import { SearchForm } from '@/presentation/components/SearchForm'
import { ContextBarSkeleton, ResultListSkeleton } from '@/presentation/components/Skeletons'
import { getTranslations } from 'next-intl/server'
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
  const common = await getTranslations('Common')
  const t = await getTranslations('Search')
  const context = await readPageContext()

  if (context.status === 'unavailable') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        {common('unavailable')} <RetryButton label={common('retry')} />
      </p>
    )
  }

  if (context.status === 'no-coverage') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        {common('noCoverage')}
      </p>
    )
  }

  return (
    <>
      <ContextBar
        regionName={context.regionName}
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
          {t('back')}
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
  // Marks this as needing a request before the first query runs.
  //
  // Without it, the partial prerender attempts this segment speculatively
  // and cancels the query the moment the static shell is done. Supabase
  // surfaces that cancellation as an ordinary query error, so the screen
  // reported a database that had never been asked: "nothing is being
  // tracked", or a search that found nothing. Both cleared on a retry,
  // which is exactly how it was reported.
  await connection()

  const common = await getTranslations('Common')
  const t = await getTranslations('Search')

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

  if (result.status === 'unavailable') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        {t('unavailable')} <RetryButton label={common('retry')} />
      </p>
    )
  }

  return (
    <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
      {result.status === 'invalid-query' && t('tooShort')}
      {result.status === 'no-stores-selected' && common('noStoresSelected')}
      {result.status === 'rate-limited' && t('rateLimited', { seconds: result.retryAfterSeconds })}
    </p>
  )
}

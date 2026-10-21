import { Suspense } from 'react'
import { RetryButton } from '@/presentation/components/RetryButton'
import { headers } from 'next/headers'
import { connection } from 'next/server'
import { getWebContainer } from '@/composition/container'
import { ContextBar } from '@/presentation/components/ContextBar'
import { InfiniteFeed } from '@/presentation/components/InfiniteFeed'
import { SearchForm } from '@/presentation/components/SearchForm'
import { ContextBarSkeleton, FeedSkeleton } from '@/presentation/components/Skeletons'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

/**
 * The shell renders at once and the regional part streams in behind a
 * skeleton.
 *
 * Both the gate and the feed depend on the same cookie, so they share one
 * boundary: the page genuinely cannot tell which of the two it is until it
 * has read the CEP, and a skeleton that resolves into the wrong shape would
 * be worse than one that covers both.
 */
export default function HomePage() {
  return (
    <Suspense
      fallback={
        <>
          <ContextBarSkeleton />
          <FeedSkeleton />
        </>
      }
    >
      <HomeBody />
    </Suspense>
  )
}

async function HomeBody() {
  const context = await readPageContext()

  if (context.status === 'unavailable') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Não consegui carregar agora. <RetryButton label="Tentar de novo" />
      </p>
    )
  }

  if (context.status === 'no-coverage') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Nenhum mercado está sendo acompanhado no momento.
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

      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ofertas em {context.regionName}</h1>
        <SearchForm autoFocus />
      </section>

      <Suspense fallback={<FeedSkeleton />}>
        <FeedSection regionId={context.regionId} storeIds={context.pickedStoreIds} />
      </Suspense>
    </>
  )
}

/**
 * Its own boundary inside the body: the store picker and the search box are
 * usable while the feed is still being priced.
 */
async function FeedSection({
  regionId,
  storeIds,
}: {
  regionId: string
  storeIds: readonly string[]
}) {
  // See the note in busca/page.tsx: without this the partial prerender
  // cancels the query mid-flight and the cancellation arrives as an
  // ordinary database error.
  await connection()

  const feed = await getWebContainer().getProductFeed.execute({
    regionId,
    storeIds,
    clientKey: clientKeyFromHeaders(await headers()),
  })

  if (feed.status === 'no-stores-selected') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Marque pelo menos um mercado ali em cima pra eu ter o que comparar.
      </p>
    )
  }

  if (feed.status === 'unavailable') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Não consegui carregar os preços agora. <RetryButton label="Tentar de novo" />
      </p>
    )
  }

  if (feed.status === 'rate-limited') {
    return (
      <p className="rounded-xl border border-rule p-4 text-sm text-ink-soft">
        Muitas consultas em pouco tempo. Tente de novo em {feed.retryAfterSeconds}s.
      </p>
    )
  }

  return <InfiniteFeed initialCards={feed.cards} initialHasMore={feed.hasMore} />
}

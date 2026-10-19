'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedCard } from '@/application/use-cases/GetProductFeed'
import { ProductFeed } from './ProductFeed'
import { FeedSkeleton } from './Skeletons'

type Props = {
  /** Server-rendered first page, so the feed is complete without JavaScript. */
  initialCards: readonly FeedCard[]
  initialHasMore: boolean
}

/**
 * Loads more cards as the reader approaches the bottom.
 *
 * The first page comes from the server already rendered, so the feed is
 * whole for a reader without JavaScript and for the crawler; this only ever
 * appends.
 *
 * The sentinel is watched with an IntersectionObserver rather than a scroll
 * listener: a scroll handler fires on every frame and has to be throttled,
 * while the observer fires once when the element actually comes near.
 * `rootMargin` starts the fetch a screen early, so the next cards are
 * usually there before the reader reaches the gap.
 */
export function InfiniteFeed({ initialCards, initialHasMore }: Props) {
  const [cards, setCards] = useState<readonly FeedCard[]>(initialCards)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [failed, setFailed] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  // A ref, not state: the observer callback closes over its first render,
  // and a stale "loading" flag there would fire the same page twice.
  const loading = useRef(false)

  const loadMore = useCallback(async () => {
    if (loading.current || !hasMore) return
    loading.current = true
    setFailed(false)

    try {
      const response = await fetch(`/api/feed?offset=${cards.length}`)
      if (!response.ok) {
        setFailed(true)
        return
      }

      const page = (await response.json()) as { cards: FeedCard[]; hasMore: boolean }
      // Guard against a duplicate page: appending one would render two cards
      // with the same key.
      const known = new Set(cards.map((card) => card.productId))
      const fresh = page.cards.filter((card) => !known.has(card.productId))

      setCards((current) => [...current, ...fresh])
      setHasMore(page.hasMore && fresh.length > 0)
    } catch {
      setFailed(true)
    } finally {
      loading.current = false
    }
  }, [cards, hasMore])

  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '600px' },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [loadMore, hasMore])

  return (
    <div className="flex flex-col gap-4">
      <ProductFeed cards={cards} />

      {hasMore && !failed && (
        <div ref={sentinel} aria-hidden="true">
          <FeedSkeleton cards={2} />
        </div>
      )}

      {failed && (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="self-center rounded-lg border border-rule-strong px-4 py-2 text-sm text-ink-soft hover:border-ink hover:text-ink"
        >
          Não consegui carregar mais. Tentar de novo
        </button>
      )}

      {!hasMore && cards.length > 0 && (
        <p className="py-2 text-center text-xs text-ink-faint">Acabaram as comparações por aqui.</p>
      )}
    </div>
  )
}

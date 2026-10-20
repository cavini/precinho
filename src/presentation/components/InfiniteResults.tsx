'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchResultItem } from '@/application/use-cases/SearchProducts'
import { ResultList } from './ResultList'
import { ResultListSkeleton } from './Skeletons'

type Props = {
  query: string
  /** Server-rendered first page, so results exist without JavaScript. */
  initialItems: readonly SearchResultItem[]
  initialHasMore: boolean
}

/**
 * Loads more results as the reader approaches the bottom.
 *
 * Searching "sabonete" used to show nineteen rows and stop, which reads as
 * "that is all there is" rather than "that is the first page" — and there
 * are thousands. The feed has scrolled since it was built; this is the
 * same mechanism pointed at search.
 *
 * Complexity: one request per page, each bounded by the use case's limit.
 */
export function InfiniteResults({ query, initialItems, initialHasMore }: Props) {
  const [items, setItems] = useState<readonly SearchResultItem[]>(initialItems)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [failed, setFailed] = useState(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  // A ref rather than state: the observer callback closes over its first
  // render, and a stale loading flag there fetches the same page twice.
  const loading = useRef(false)

  const loadMore = useCallback(async () => {
    if (loading.current || !hasMore) return
    loading.current = true
    setFailed(false)

    try {
      const response = await fetch(
        `/api/busca?q=${encodeURIComponent(query)}&offset=${items.length}`,
      )
      if (!response.ok) {
        setFailed(true)
        return
      }

      const page = (await response.json()) as {
        items: SearchResultItem[]
        hasMore: boolean
      }

      setItems((current) => [...current, ...page.items])
      setHasMore(page.hasMore)
    } catch {
      setFailed(true)
    } finally {
      loading.current = false
    }
  }, [hasMore, items.length, query])

  useEffect(() => {
    const target = sentinel.current
    if (!target || !hasMore) return

    // An observer rather than a scroll listener: a scroll handler fires every
    // frame and needs throttling, while this fires once when the element
    // nears. The margin starts the fetch a screen early.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { rootMargin: '600px' },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  return (
    <div className="flex flex-col gap-4">
      <ResultList query={query} items={items} />

      {hasMore && <div ref={sentinel} aria-hidden="true" />}
      {hasMore && !failed && <ResultListSkeleton rows={3} />}

      {failed && (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="self-center rounded-full border border-rule px-4 py-2 text-sm text-ink-soft hover:text-ink"
        >
          Não consegui carregar mais. Tentar de novo
        </button>
      )}
    </div>
  )
}

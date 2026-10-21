import { NextResponse } from 'next/server'
import { getWebContainer } from '@/composition/container'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

/** Never trust a page number from the query string to be a number. */
const MAX_OFFSET = 600

/**
 * The next page of feed cards, for the infinite scroll.
 *
 * Reads the same cookie the server-rendered first page did, so the shopper's
 * CEP and store picks cannot be overridden by whoever calls this — the only
 * thing the caller controls is how far down the list they are.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const context = await readPageContext()
  if (context.status !== 'ready') {
    return NextResponse.json({ error: 'sem CEP' }, { status: 409 })
  }

  const requested = Number(new URL(request.url).searchParams.get('offset'))
  if (!Number.isFinite(requested) || requested < 0 || requested > MAX_OFFSET) {
    return NextResponse.json({ error: 'offset inválido' }, { status: 400 })
  }

  const feed = await getWebContainer().getProductFeed.execute({
    regionId: context.regionId,
    storeIds: context.pickedStoreIds,
    offset: Math.floor(requested),
    clientKey: clientKeyFromHeaders(request.headers),
  })

  if (feed.status === 'rate-limited') {
    return NextResponse.json(
      { error: 'muitas requisições' },
      { status: 429, headers: { 'Retry-After': String(feed.retryAfterSeconds) } },
    )
  }

  if (feed.status === 'unavailable') {
    // Not an empty page: the scroll would take that as the end of the
    // feed and stop, quietly, as though there were nothing more.
    return NextResponse.json({ error: 'indisponível' }, { status: 503 })
  }

  if (feed.status !== 'ok') {
    return NextResponse.json({ cards: [], hasMore: false })
  }

  return NextResponse.json({ cards: feed.cards, hasMore: feed.hasMore })
}

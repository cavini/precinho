import { NextResponse } from 'next/server'
import { SearchProducts } from '@/application/use-cases/SearchProducts'
import { getWebContainer } from '@/composition/container'
import { clientKeyFromHeaders } from '@/presentation/clientKey'
import { readPageContext } from '@/presentation/server/shoppingContext'

/**
 * The next page of search results, for the infinite scroll.
 *
 * Reads the shopper's CEP and store picks from the same cookie the
 * server-rendered first page used, so a caller controls only the query and
 * how far down the list they are — never which region's prices they see.
 *
 * Complexity: one query, bounded by the function's own candidate cap.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const context = await readPageContext()

  // 503 rather than 409: a coverage read that failed is ours to fix and
  // worth retrying, while a client error tells the caller to stop.
  if (context.status === 'unavailable') {
    return NextResponse.json({ error: 'indisponível' }, { status: 503 })
  }
  if (context.status !== 'ready') {
    return NextResponse.json({ error: 'sem cobertura' }, { status: 409 })
  }

  const params = new URL(request.url).searchParams
  const query = params.get('q') ?? ''
  const requested = Number(params.get('offset'))

  if (!Number.isFinite(requested) || requested < 0 || requested > SearchProducts.MAX_OFFSET) {
    return NextResponse.json({ error: 'offset inválido' }, { status: 400 })
  }

  const result = await getWebContainer().searchProducts.execute({
    rawQuery: query,
    regionId: context.regionId,
    storeIds: context.pickedStoreIds,
    offset: Math.floor(requested),
    clientKey: clientKeyFromHeaders(request.headers),
  })

  if (result.status === 'rate-limited') {
    return NextResponse.json(
      { error: 'muitas buscas' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
    )
  }

  if (result.status === 'unavailable') {
    // Not an empty page: the scroll would read that as the end of the
    // results and stop, quietly, as though there were nothing more.
    return NextResponse.json({ error: 'indisponível' }, { status: 503 })
  }

  if (result.status !== 'ok') {
    return NextResponse.json({ items: [], hasMore: false })
  }

  return NextResponse.json({ items: result.items, hasMore: result.hasMore })
}

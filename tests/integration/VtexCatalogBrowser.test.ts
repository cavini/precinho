import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { VtexCatalogBrowser, VTEX_SLICE_CEILING } from '@/infrastructure/gateways/vtex/VtexCatalogBrowser'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

const TREE = /category\/tree/

/** Mambo's real shape: one root, aisles beneath it. */
const MAMBO_TREE = [
  {
    id: 1589,
    name: 'Mambo',
    children: [
      { id: 1592, name: 'Bebidas' },
      {
        id: 1595,
        name: 'Frios e Laticínios',
        children: [
          { id: 1601, name: 'Queijos' },
          { id: 1602, name: 'Iogurtes' },
        ],
      },
    ],
  },
]

/**
 * Answers a count request with `resources: 0-0/N`, keyed by category path,
 * and a page request with the given products.
 */
function fakeStore(counts: Record<string, number>, page: FakeResponse) {
  const http = {
    requests: [] as Array<{ url: string }>,
    async getJson(url: string) {
      this.requests.push({ url })

      if (TREE.test(url)) {
        return { status: 'ok' as const, statusCode: 200, body: MAMBO_TREE, headers: {} }
      }

      const fq = decodeURIComponent(new URL(url).searchParams.get('fq') ?? '')
      const isCount = new URL(url).searchParams.get('_to') === '0'

      if (isCount) {
        const size = counts[fq]
        if (size === undefined) return { status: 'http-error' as const, statusCode: 404 }
        return {
          status: 'ok' as const,
          statusCode: 206,
          body: [],
          headers: { resources: `0-0/${size}` },
        }
      }

      return page.status === 'ok' ? { ...page, headers: page.headers ?? {} } : page
    },
    async postJson() {
      throw new Error('not used')
    },
  }

  const browser = new VtexCatalogBrowser(
    { storeId: 'mambo', host: 'www.mambo.com.br' },
    http,
    new RecordingLogger(),
  )

  return { browser, http }
}

const EMPTY_PAGE = { status: 'ok', statusCode: 206, body: [] } as const

describe('VtexCatalogBrowser planning a sweep', () => {
  it('keeps a category that fits under the ceiling whole', async () => {
    const { browser } = fakeStore(
      { 'C:/1589/1592/': 985, 'C:/1589/1595/': 1873 },
      EMPTY_PAGE,
    )

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.slices.map((s) => s.label)).toEqual(['Bebidas', 'Frios e Laticínios'])
    expect(plan.slices.map((s) => s.size)).toEqual([985, 1873])
  })

  it('opens a category that overflows, and keeps its children instead', async () => {
    // VTEX refuses an offset past 2,500, so a 9,000-product aisle can never
    // be read whole. The children are what actually fit.
    const { browser } = fakeStore(
      {
        'C:/1589/1592/': 500,
        'C:/1589/1595/': 9_000,
        'C:/1589/1595/1601/': 1_200,
        'C:/1589/1595/1602/': 800,
      },
      EMPTY_PAGE,
    )

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.slices.map((s) => s.label)).toEqual(['Bebidas', 'Queijos', 'Iogurtes'])
    expect(plan.slices.map((s) => s.id)).toContain('/1589/1595/1601')
  })

  it('reports a leaf that overflows rather than pretending it swept it', async () => {
    // A sweep that silently misses a third of an aisle looks exactly like a
    // sweep that worked.
    const { browser } = fakeStore({ 'C:/1589/1592/': 9_000, 'C:/1589/1595/': 10 }, EMPTY_PAGE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.unreachable.map((s) => s.label)).toEqual(['Bebidas'])
    // Still swept: 2,550 of an aisle beats none of it.
    expect(plan.slices.map((s) => s.label)).toContain('Bebidas')
  })

  it('skips an empty category rather than paging it', async () => {
    const { browser } = fakeStore({ 'C:/1589/1592/': 0, 'C:/1589/1595/': 10 }, EMPTY_PAGE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.label)).toEqual(['Frios e Laticínios'])
  })

  it('never probes the root, which can never fit', async () => {
    const { browser, http } = fakeStore(
      { 'C:/1589/1592/': 10, 'C:/1589/1595/': 10 },
      EMPTY_PAGE,
    )

    await browser.planSweep()
    const probedRoot = http.requests.some((r) => decodeURIComponent(r.url).includes('fq=C:/1589/&'))
    expect(probedRoot).toBe(false)
  })

  it('costs a request per probed node, not per node in the tree', async () => {
    // Probing everything would be 702 requests at Mambo just to decide what
    // to fetch.
    const { browser } = fakeStore({ 'C:/1589/1592/': 10, 'C:/1589/1595/': 10 }, EMPTY_PAGE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    // One tree fetch plus the two top-level aisles; the two leaves under
    // Frios are never opened because it already fits.
    expect(plan.requestsSpent).toBe(3)
  })

  it('reports the whole plan as unavailable when the tree will not load', async () => {
    const http = new FakeHttpClient([
      { match: TREE, response: { status: 'http-error', statusCode: 503 } },
    ])
    const browser = new VtexCatalogBrowser(
      { storeId: 'mambo', host: 'www.mambo.com.br' },
      http,
      new RecordingLogger(),
    )

    expect(await browser.planSweep()).toMatchObject({ status: 'unavailable' })
  })

  it('drops a category whose size cannot be read rather than guessing', async () => {
    const { browser } = fakeStore({ 'C:/1589/1595/': 10 }, EMPTY_PAGE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.label)).toEqual(['Frios e Laticínios'])
  })
})

describe('VtexCatalogBrowser fetching pages', () => {
  const slice = { id: '/1589/1592', label: 'Bebidas', size: 120 }

  it('asks for a fifty-wide window, which is the most VTEX allows', async () => {
    const { browser, http } = fakeStore({}, EMPTY_PAGE)
    await browser.fetchPage(slice, 0)

    const url = new URL(http.requests[0].url)
    expect(url.searchParams.get('_from')).toBe('0')
    expect(url.searchParams.get('_to')).toBe('49')
  })

  it('walks forward by one window per page', async () => {
    const { browser, http } = fakeStore({}, EMPTY_PAGE)
    await browser.fetchPage(slice, 3)

    const url = new URL(http.requests[0].url)
    expect(url.searchParams.get('_from')).toBe('150')
    expect(url.searchParams.get('_to')).toBe('199')
  })

  it('stops at the offset ceiling instead of letting VTEX refuse', async () => {
    // Offset 2,501 is a 400 from the platform; returning empty ends the
    // slice cleanly on our side.
    const { browser, http } = fakeStore({}, EMPTY_PAGE)

    const result = await browser.fetchPage(slice, 51)
    expect(result).toEqual({ status: 'ok', products: [] })
    expect(http.requests).toHaveLength(0)
  })

  it('maps products exactly as a keyword search does', async () => {
    const body = [
      {
        productId: '1',
        productName: 'Refrigerante Coca-Cola 2L',
        brand: 'Coca-cola',
        link: 'https://www.mambo.com.br/coca-2l/p',
        items: [
          {
            ean: '7894900027013',
            sellers: [{ commertialOffer: { Price: 10.49, AvailableQuantity: 5 } }],
          },
        ],
      },
    ]
    const { browser } = fakeStore({}, { status: 'ok', statusCode: 206, body })

    const result = await browser.fetchPage(slice, 0)
    if (result.status !== 'ok') throw new Error(result.reason)

    expect(result.products[0]).toMatchObject({
      name: 'Refrigerante Coca-Cola 2L',
      ean: '7894900027013',
      priceReais: 10.49,
      inStock: true,
    })
  })
})

describe('the ceiling itself', () => {
  it('is the product of the two limits VTEX enforces', () => {
    // Window of 50 and a last offset of 2,500 give 2,550 reachable items.
    expect(VTEX_SLICE_CEILING).toBe(2_550)
  })
})

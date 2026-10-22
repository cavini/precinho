import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { SfccCatalogBrowser, SFCC_PAGE_SIZE } from '@/infrastructure/gateways/sfcc/SfccCatalogBrowser'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'

const SESSION: FakeResponse = {
  status: 'ok',
  statusCode: 200,
  body: {},
  headers: { 'set-cookie': 'dwsid=abc123; Path=/' },
}

/** One row in the shape Search-UpdateGrid returns. */
const row = (name: string) => ({
  productName: name,
  id: name,
  productUrl: `https://www.nagumo.com.br/categoria/departamentos/x/y/${name}.html`,
  price: { sales: { value: 9.9 } },
  available: true,
})

const grid = (count: number): FakeResponse => ({
  status: 'ok',
  statusCode: 200,
  body: {
    count,
    productsSearchResult: Array.from({ length: count }, (_, i) => row(`p${i}`)),
  },
})

function build(page: FakeResponse) {
  const http = new FakeHttpClient([
    { match: /Stores-SelectStore/, response: SESSION },
    { match: /Search-UpdateGrid/, response: page },
  ])
  const browser = new SfccCatalogBrowser(
    {
      storeId: 'nagumo',
      host: 'www.nagumo.com.br',
      siteId: 'Nagumo',
      sfccStoreId: '25',
      categories: ['commodities', 'bovino'],
    },
    http,
    new RecordingLogger(),
  )
  return { browser, http }
}

describe('SfccCatalogBrowser', () => {
  it('plans from the configured categories without spending a request', async () => {
    const { browser, http } = build(grid(0))

    const plan = await browser.planSweep()

    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.id)).toEqual(['commodities', 'bovino'])
    expect(plan.requestsSpent).toBe(0)
    expect(http.requests).toHaveLength(0)
  })

  it('refuses a plan with no categories rather than sweeping nothing', async () => {
    const http = new FakeHttpClient([{ match: /./, response: SESSION }])
    const browser = new SfccCatalogBrowser(
      { storeId: 'nagumo', host: 'h', siteId: 'S', sfccStoreId: '25', categories: [] },
      http,
      new RecordingLogger(),
    )

    const plan = await browser.planSweep()

    // A row switched to category mode with an empty list would otherwise
    // report a successful sweep of zero products.
    expect(plan.status).toBe('unavailable')
  })

  it('asks for the widest window the controller serves', async () => {
    const { browser, http } = build(grid(SFCC_PAGE_SIZE))

    await browser.fetchPage({ id: 'commodities', label: 'commodities', size: 1 }, 0)

    expect(http.lastUrl).toContain(`sz=${SFCC_PAGE_SIZE}`)
    expect(browser.pageSize).toBe(SFCC_PAGE_SIZE)
  })

  it('selects a category by cgid and pages it with start', async () => {
    const { browser, http } = build(grid(1))

    await browser.fetchPage({ id: 'bovino', label: 'bovino', size: 1 }, 2)

    expect(http.lastUrl).toContain('cgid=bovino')
    expect(http.lastUrl).toContain(`start=${2 * SFCC_PAGE_SIZE}`)
    // The keyword parameter must not travel with it, or the controller
    // intersects the two and answers with almost nothing.
    expect(http.lastUrl).not.toContain('q=')
  })

  it('reports the raw row count so a short page can end the slice', async () => {
    const { browser } = build(grid(37))

    const result = await browser.fetchPage({ id: 'bovino', label: 'bovino', size: 1 }, 0)

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.received).toBe(37)
  })
})

import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { RequestBudget } from '@/domain/services/RequestBudget'
import { MagentoCatalogBrowser } from '@/infrastructure/gateways/magento/MagentoCatalogBrowser'

/**
 * Tauste's real shape, trimmed: a root, a childless "Departamentos" holding
 * the entire catalogue, and the themed departments beside it.
 */
const TAUSTE_TREE = [
  {
    uid: 'Mg==',
    name: 'Default Category',
    product_count: 18_791,
    children: [
      {
        uid: 'NA==',
        name: 'Departamentos',
        product_count: 18_791,
        children: [],
      },
      { uid: 'NQ==', name: 'Novidades', product_count: 317, children: [] },
      {
        uid: 'Ng==',
        name: 'Bebidas Alcoólicas',
        product_count: 1_572,
        children: [
          { uid: 'Nw==', name: 'Cervejas', product_count: 420 },
          { uid: 'OA==', name: 'Vinhos', product_count: 610 },
        ],
      },
    ],
  },
]

/** URLSearchParams writes a space as '+', which decodeURIComponent leaves alone. */
const sent = (url: string) => decodeURIComponent(url).replace(/\+/g, ' ')

function fakeStore(tree: unknown, pages: unknown[][] = [[]], budget?: RequestBudget) {
  const http = {
    requests: [] as string[],
    async getJson(url: string) {
      this.requests.push(url)

      if (decodeURIComponent(url).includes('categoryList')) {
        return {
          status: 'ok' as const,
          statusCode: 200,
          body: { data: { categoryList: tree } },
          headers: {},
        }
      }

      const items = pages.shift() ?? []
      return {
        status: 'ok' as const,
        statusCode: 200,
        body: { data: { products: { items } } },
        headers: {},
      }
    },
    async postJson() {
      throw new Error('not used')
    },
  }

  const browser = new MagentoCatalogBrowser(
    { storeId: 'tauste', host: 'www.tauste.com.br', budget },
    http,
    new RecordingLogger(),
  )

  return { browser, http }
}

describe('MagentoCatalogBrowser planning a sweep', () => {
  it('costs one request for the whole plan', async () => {
    // The decisive difference from VTEX, which charges a request per
    // category just to learn its size. It is what makes a complete sweep
    // fit inside an allowance somebody asked us to respect.
    const { browser, http } = fakeStore(TAUSTE_TREE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.requestsSpent).toBe(1)
    expect(http.requests).toHaveLength(1)
  })

  it('keeps the leaves and drops the parents that contain them', async () => {
    // A parent's product_count includes its descendants, so sweeping both
    // fetches every product twice.
    const { browser } = fakeStore(TAUSTE_TREE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.slices.map((s) => s.label)).toEqual(['Novidades', 'Cervejas', 'Vinhos'])
  })

  it('skips a childless category holding the entire catalogue', async () => {
    // Tauste has one called "Departamentos" carrying all 18,791 products
    // beside the 24 real departments. Treating it as a leaf would have
    // doubled the run and spent the allowance on duplicates.
    const { browser } = fakeStore(TAUSTE_TREE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)

    expect(plan.slices.map((s) => s.label)).not.toContain('Departamentos')
  })

  it('still keeps a legitimate leaf that happens to be large', async () => {
    // The rule is "holds everything", not "holds a lot" — otherwise the
    // biggest real aisle in a small shop would vanish.
    const tree = [
      {
        uid: 'root',
        name: 'Default Category',
        product_count: 1_000,
        children: [
          { uid: 'big', name: 'Mercearia', product_count: 999, children: [] },
          { uid: 'small', name: 'Bazar', product_count: 1, children: [] },
        ],
      },
    ]
    const { browser } = fakeStore(tree)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.label)).toEqual(['Mercearia', 'Bazar'])
  })

  it('keeps the only department in a shop that has just one', async () => {
    // Without the sibling condition this looks exactly like a mirror, and
    // dropping it would collect nothing at all.
    const tree = [
      {
        uid: 'root',
        name: 'Default Category',
        product_count: 10,
        children: [{ uid: 'only', name: 'Mercearia', product_count: 10, children: [] }],
      },
    ]
    const { browser } = fakeStore(tree)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.label)).toEqual(['Mercearia'])
  })

  it('skips an empty category rather than paging it', async () => {
    const tree = [
      {
        uid: 'root',
        name: 'Default Category',
        product_count: 10,
        children: [
          { uid: 'a', name: 'Vazia', product_count: 0, children: [] },
          { uid: 'b', name: 'Cheia', product_count: 10, children: [] },
        ],
      },
    ]
    const { browser } = fakeStore(tree)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.slices.map((s) => s.label)).toEqual(['Cheia'])
  })

  it('reports nothing unreachable, because Magento pages to the end', async () => {
    const { browser } = fakeStore(TAUSTE_TREE)

    const plan = await browser.planSweep()
    if (plan.status !== 'ok') throw new Error(plan.reason)
    expect(plan.unreachable).toEqual([])
  })

  it('is unavailable when the tree will not load', async () => {
    const http = {
      async getJson() {
        return { status: 'http-error' as const, statusCode: 503 }
      },
      async postJson() {
        throw new Error('not used')
      },
    }
    const browser = new MagentoCatalogBrowser(
      { storeId: 'tauste', host: 'www.tauste.com.br' },
      http,
      new RecordingLogger(),
    )

    expect(await browser.planSweep()).toMatchObject({ status: 'unavailable' })
  })

  it('is unavailable when GraphQL answers with errors', async () => {
    const http = {
      async getJson() {
        return {
          status: 'ok' as const,
          statusCode: 200,
          body: { errors: [{ message: 'Field "product_count" not found' }] },
          headers: {},
        }
      },
      async postJson() {
        throw new Error('not used')
      },
    }
    const browser = new MagentoCatalogBrowser(
      { storeId: 'tauste', host: 'www.tauste.com.br' },
      http,
      new RecordingLogger(),
    )

    expect(await browser.planSweep()).toMatchObject({ status: 'unavailable' })
  })

  it('spends the store’s daily allowance on the tree like any other request', async () => {
    const exhausted = RequestBudget.of(0)
    const { browser, http } = fakeStore(TAUSTE_TREE, [[]], exhausted)

    expect(await browser.planSweep()).toMatchObject({ status: 'unavailable' })
    expect(http.requests).toHaveLength(0)
  })
})

describe('MagentoCatalogBrowser fetching pages', () => {
  const slice = { id: 'Nw==', label: 'Cervejas', size: 420 }

  it('counts pages from one, as Magento does', async () => {
    // Every other API here is offset-based; getting this wrong silently
    // skips the first 200 products of every category.
    const { browser, http } = fakeStore(TAUSTE_TREE, [[], []])

    await browser.fetchPage(slice, 0)
    const query = sent(http.requests[0])

    expect(query).toContain('currentPage: 1')
  })

  it('walks forward one page at a time', async () => {
    const { browser, http } = fakeStore(TAUSTE_TREE, [[], []])

    await browser.fetchPage(slice, 3)
    expect(sent(http.requests[0])).toContain('currentPage: 4')
  })

  it('asks for two hundred at a time, which is why browsing is cheap', async () => {
    const { browser, http } = fakeStore(TAUSTE_TREE, [[]])

    await browser.fetchPage(slice, 0)
    expect(sent(http.requests[0])).toContain('pageSize: 200')
  })

  it('filters by the category, not by a search term', async () => {
    const { browser, http } = fakeStore(TAUSTE_TREE, [[]])

    await browser.fetchPage(slice, 0)
    const query = sent(http.requests[0])

    expect(query).toContain('category_uid')
    expect(query).toContain('Nw==')
    expect(query).not.toContain('products(search:')
  })

  it('maps products exactly as a keyword search does', async () => {
    const items = [
      {
        name: 'Cerveja Heineken Long Neck 330ml',
        sku: '7896045506095',
        url_key: 'cerveja-heineken-330ml',
        price_range: { minimum_price: { final_price: { value: 7.49 } } },
        stock_status: 'IN_STOCK',
      },
    ]
    const { browser } = fakeStore(TAUSTE_TREE, [items])

    const result = await browser.fetchPage(slice, 0)
    if (result.status !== 'ok') throw new Error(result.reason)

    expect(result.products[0]).toMatchObject({
      name: 'Cerveja Heineken Long Neck 330ml',
      priceReais: 7.49,
      inStock: true,
    })
  })
})

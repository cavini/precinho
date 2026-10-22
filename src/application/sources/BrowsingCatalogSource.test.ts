import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '../testing/RecordingLogger'
import type { CatalogBrowser, CatalogSlice, SweepPlan } from '../ports/CatalogBrowser'
import type { CatalogProduct, CatalogSearchResult } from '../ports/StoreCatalogGateway'
import { BrowsingCatalogSource } from './BrowsingCatalogSource'

const product = (name: string): CatalogProduct => ({
  externalId: name,
  name,
  brand: null,
  ean: null,
  description: null,
  imageUrl: null,
  url: 'https://example.test/p',
  priceReais: 1,
  listPriceReais: null,
  inStock: true,
})

const page = (count: number, received = count): CatalogSearchResult => ({
  status: 'ok',
  products: Array.from({ length: count }, (_, index) => product(`p${index}`)),
  received,
})

/** Just the products, for a page that reports no raw row count. */
const pageProducts = (count: number): readonly CatalogProduct[] =>
  Array.from({ length: count }, (_, index) => product(`p${index}`))

const slice = (label: string, size: number): CatalogSlice => ({
  id: label,
  label,
  size,
})

class StubBrowser implements CatalogBrowser {
  readonly fetched: Array<{ slice: string; page: number }> = []

  constructor(
    readonly storeId: string,
    private readonly plan: SweepPlan,
    /** Page results keyed by `${slice}:${page}`; anything missing is empty. */
    private readonly pages: Record<string, CatalogSearchResult> = {},
    readonly pageSize = 200,
  ) {}

  async planSweep(): Promise<SweepPlan> {
    return this.plan
  }

  async fetchPage(target: CatalogSlice, index: number): Promise<CatalogSearchResult> {
    this.fetched.push({ slice: target.label, page: index })
    return this.pages[`${target.label}:${index}`] ?? page(0)
  }
}

const okPlan = (slices: CatalogSlice[], unreachable: CatalogSlice[] = []): SweepPlan => ({
  status: 'ok',
  slices,
  unreachable,
  requestsSpent: 1,
})

async function drain(source: BrowsingCatalogSource) {
  const out = []
  for await (const item of source.pages()) out.push(item)
  return out
}

describe('BrowsingCatalogSource', () => {
  it('pages a slice until the store runs out of products', async () => {
    const browser = new StubBrowser('tauste', okPlan([slice('Cervejas', 420)]), {
      'Cervejas:0': page(200),
      'Cervejas:1': page(200),
      'Cervejas:2': page(20),
    })

    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(pages).toHaveLength(3)
    // Three requests, not four: the last page came back short of the page
    // size with the whole slice already in hand, so there was nothing left
    // to confirm.
    expect(browser.fetched.map((f) => f.page)).toEqual([0, 1, 2])
  })

  it('learns the page size from the first page rather than assuming it', async () => {
    // A store that quietly caps page size below what we asked for would
    // otherwise strand the tail of every category.
    const browser = new StubBrowser('tauste', okPlan([slice('Cervejas', 300)]), {
      'Cervejas:0': page(50),
      'Cervejas:1': page(50),
      'Cervejas:2': page(50),
      'Cervejas:3': page(50),
      'Cervejas:4': page(50),
      'Cervejas:5': page(50),
    })

    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))
    expect(pages).toHaveLength(6)
  })

  it('stops a slice at the page count its size implies', async () => {
    // A category that keeps answering forever must not loop forever.
    const endless: Record<string, CatalogSearchResult> = {}
    for (let index = 0; index < 50; index += 1) endless[`Cervejas:${index}`] = page(200)

    const browser = new StubBrowser('tauste', okPlan([slice('Cervejas', 400)]), endless)
    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    // Two pages of 200, plus the spare that covers counts drifting.
    expect(pages).toHaveLength(3)
  })

  it('moves on to the next category when one refuses', async () => {
    const browser = new StubBrowser(
      'tauste',
      okPlan([slice('Cervejas', 10), slice('Vinhos', 10)]),
      {
        'Cervejas:0': { status: 'unavailable', reason: 'http-error' },
        'Vinhos:0': page(10),
      },
    )

    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(pages[0]).toEqual({ status: 'failed', label: 'Cervejas' })
    expect(pages[1].status).toBe('ok')
  })

  it('abandons the sweep once refusals stop being incidental', () => {
    // An allowance that has run out, or a shop that has gone down, should
    // end the run rather than be asked another hundred times.
    const slices = Array.from({ length: 50 }, (_, index) => slice(`c${index}`, 10))

    class AlwaysRefuses implements CatalogBrowser {
      readonly storeId = 'tauste'
      readonly pageSize = 200
      async planSweep(): Promise<SweepPlan> {
        return okPlan(slices)
      }
      async fetchPage(): Promise<CatalogSearchResult> {
        return { status: 'unavailable', reason: 'budget-exhausted' }
      }
    }

    return drain(new BrowsingCatalogSource(new AlwaysRefuses(), new RecordingLogger())).then(
      (pages) => expect(pages).toHaveLength(5),
    )
  })

  it('reports one failure when the plan itself will not load', async () => {
    const browser = new StubBrowser('tauste', {
      status: 'unavailable',
      reason: 'category-tree',
    })

    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))
    expect(pages).toEqual([{ status: 'failed', label: 'plan:category-tree' }])
  })

  it('says out loud when part of the catalogue is out of reach', async () => {
    // A sweep that silently misses a third of an aisle looks exactly like
    // a sweep that worked.
    const logger = new RecordingLogger()
    const browser = new StubBrowser(
      'mambo',
      okPlan([slice('Bebidas', 2_550)], [slice('Bebidas', 9_000)]),
    )

    await drain(new BrowsingCatalogSource(browser, logger))

    expect(logger.lines.some((entry) => entry.message === 'sweep.partially_unreachable')).toBe(true)
  })

  it('skips an empty category without a second request', async () => {
    const browser = new StubBrowser('tauste', okPlan([slice('Vazia', 0)]))

    const pages = await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(pages).toEqual([])
    expect(browser.fetched).toHaveLength(1)
  })
})


/**
 * A slice that fits in one page used to cost two requests.
 *
 * `expectedPages` was `ceil(size / products.length) + 1`, and the spare
 * page was bought every time rather than only when there was reason to
 * think more was coming. At Tauste that is about 115 wasted requests out
 * of the 231 the sweep needs, against an allowance of 200 they asked us to
 * respect — so the sweep ran out and abandoned the rest of the tree,
 * losing roughly 3,557 products a night.
 *
 * A page that comes back short of the page size is the store saying there
 * is no more, which is why the raw row count has to travel with the page:
 * the mapper drops rows it cannot price, so a full page of 200 can arrive
 * here as 180 products and must not be read as the end.
 */
describe('paging a slice without buying an empty page', () => {
  it('stops after one page when the store returns fewer rows than it could', async () => {
    const browser = new StubBrowser('tauste', okPlan([slice('mercearia', 150)]), {
      'mercearia:0': page(150),
    })

    await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(browser.fetched).toEqual([{ slice: 'mercearia', page: 0 }])
  })

  it('keeps asking while the pages come back full', async () => {
    const browser = new StubBrowser('tauste', okPlan([slice('mercearia', 400)]), {
      'mercearia:0': page(200),
      'mercearia:1': page(200),
      'mercearia:2': page(30),
    })

    await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(browser.fetched.map((f) => f.page)).toEqual([0, 1, 2])
  })

  it('reads a full page whose rows were dropped by the mapper as still full', async () => {
    // 200 rows arrived, 180 could be priced. The slice is not over.
    const browser = new StubBrowser('tauste', okPlan([slice('mercearia', 400)]), {
      'mercearia:0': page(180, 200),
      'mercearia:1': page(12, 12),
    })

    await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(browser.fetched.map((f) => f.page)).toEqual([0, 1])
  })

  it('still trusts a full last page over a stale count from the planner', async () => {
    // The planner said 200; the aisle has grown since. A full page means
    // ask again, whatever the plan claimed.
    const browser = new StubBrowser('tauste', okPlan([slice('mercearia', 200)]), {
      'mercearia:0': page(200),
      'mercearia:1': page(45),
    })

    await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(browser.fetched.map((f) => f.page)).toEqual([0, 1])
  })

  it('falls back to the old count-based guess when a page does not report its rows', async () => {
    // A browser that has not been updated must keep working.
    const browser = new StubBrowser('legacy', okPlan([slice('aisle', 150)]), {
      'aisle:0': { status: 'ok', products: pageProducts(150) },
    })

    await drain(new BrowsingCatalogSource(browser, new RecordingLogger()))

    expect(browser.fetched.map((f) => f.page)).toEqual([0, 1])
  })
})

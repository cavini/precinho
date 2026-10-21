import { describe, expect, it } from 'vitest'
import type {
  CatalogProduct,
  CatalogSearchResult,
  StoreCatalogGateway,
} from '../ports/StoreCatalogGateway'
import { TermCatalogSource } from './TermCatalogSource'

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

class StubGateway implements StoreCatalogGateway {
  readonly asked: string[] = []
  constructor(
    readonly storeId: string,
    private readonly byTerm: Record<string, CatalogSearchResult>,
  ) {}

  async searchTerm(term: string): Promise<CatalogSearchResult> {
    this.asked.push(term)
    return this.byTerm[term] ?? { status: 'failed', reason: 'not-stubbed' }
  }
}

async function drain<T>(pages: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const page of pages) out.push(page)
  return out
}

describe('TermCatalogSource', () => {
  it('produces one page per term, labelled with it', async () => {
    const gateway = new StubGateway('mambo', {
      coca: { status: 'ok', products: [product('Coca-Cola 2L')] },
      leite: { status: 'ok', products: [product('Leite Integral 1L')] },
    })

    const pages = await drain(new TermCatalogSource(gateway, ['coca', 'leite']).pages())

    expect(pages.map((page) => page.label)).toEqual(['coca', 'leite'])
  })

  it('reports a refused term rather than ending the sweep', async () => {
    // A run is expected to be partly broken; aborting on the first refusal
    // throws away everything already found.
    const gateway = new StubGateway('mambo', {
      leite: { status: 'ok', products: [product('Leite Integral 1L')] },
    })

    const pages = await drain(new TermCatalogSource(gateway, ['coca', 'leite']).pages())

    expect(pages[0]).toEqual({ status: 'failed', label: 'coca' })
    expect(pages[1].status).toBe('ok')
  })

  it('asks lazily, one term at a time', async () => {
    // A 422-term basket must not be fired off in one burst past the
    // gateway's pacing.
    const gateway = new StubGateway('mambo', {
      coca: { status: 'ok', products: [] },
    })
    const iterator = new TermCatalogSource(gateway, ['coca', 'leite'])
      .pages()
      [Symbol.asyncIterator]()

    await iterator.next()
    expect(gateway.asked).toEqual(['coca'])
  })
})

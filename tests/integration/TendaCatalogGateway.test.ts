import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { Ean } from '@/domain/value-objects/Ean'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { TendaCatalogGateway } from '@/infrastructure/gateways/tenda/TendaCatalogGateway'
import type { TendaStoreConfig } from '@/infrastructure/gateways/tenda/TendaCatalogGateway'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Names, SKUs, barcodes and prices are Tenda's, read on 2026-10-19. */
const TENDA_ARROZ: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/tenda-arroz-search.json'), 'utf8'),
)

const SEARCH = /public\/store\/search/

function build(response: FakeResponse, config: Partial<TendaStoreConfig> = {}) {
  const http = new FakeHttpClient([{ match: SEARCH, response }])
  const logger = new RecordingLogger()
  const gateway = new TendaCatalogGateway({ storeId: 'tenda', ...config }, http, logger)
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 200, body: TENDA_ARROZ } as const

/** Fails the test rather than letting an unavailable result read as empty. */
async function search(gateway: TendaCatalogGateway, term = 'arroz') {
  const result = await gateway.searchTerm(term)
  if (result.status !== 'ok') throw new Error(result.reason)
  return result.products
}

describe('TendaCatalogGateway against a recorded Tenda response', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    expect(await search(gateway)).toHaveLength(4)
  })

  it('reads name, price, brand and stock', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0]).toMatchObject({
      name: 'Arroz Tipo 1 Visconde 5kg',
      externalId: '000000000000976178-PT',
      brand: 'Visconde',
      priceReais: 16.99,
      inStock: true,
    })
  })

  it('publishes a barcode, unlike the Magento catalogue', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.map((p) => p.ean)).toEqual([
      '7896909500016',
      '7896038357017',
      '7896006711124',
      '7896006755517',
    ])
  })

  it('yields barcodes the domain will actually verify', async () => {
    // The point of carrying an EAN at all: these rows can merge with another
    // store's on a GTIN instead of falling back to the approximate matcher.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.every((p) => Ean.tryParse(p.ean) !== null)).toBe(true)
  })

  it('moves the product link onto the canonical host', async () => {
    // The API answers on the bare domain, which 301s to www.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].url).toBe(
      'https://www.tendaatacado.com.br/produto/arroz-tipo-1-visconde-5kg-2500',
    )
  })

  it('takes the image from the thumbnail', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].imageUrl).toBe('https://d3gdr9n5lqb5z7.cloudfront.net/fotos/1782.jpg')
  })

  it('reports no list price, because none of the cheaper prices is one', async () => {
    // Visconde carries two app-and-card promotions at 14.99 and 15.99 and
    // the others carry a three-unit wholesale price. All are below the shelf
    // price, so none is the struck-out original this field means.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.every((p) => p.listPriceReais === null)).toBe(true)
  })

  it('ignores the app-only promotion when pricing', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].priceReais).toBe(16.99)
  })

  it('ignores the wholesale price, which needs three units', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[2].priceReais).toBe(10.29)
  })

  it('still yields a size the domain can read from the name', async () => {
    const parser = new ProductNameParser()
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(parser.extractSize(products[0].name)).toEqual({ amount: 5, unit: 'kg' })
  })
})

describe('TendaCatalogGateway stock, per branch', () => {
  it('takes the chain-wide flag when no branch is configured', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.every((p) => p.inStock)).toBe(true)
  })

  it('narrows stock to the configured branch', async () => {
    // Branch 5 holds the two Camil lines and neither of the others, even
    // though all four are in_stock somewhere in the chain.
    const { gateway } = build(okWithFixture, { branchId: '5' })
    const products = await search(gateway)

    expect(products.map((p) => p.inStock)).toEqual([false, false, true, true])
  })

  it('treats a branch the product does not list as out of stock there', async () => {
    const { gateway } = build(okWithFixture, { branchId: '999' })
    const products = await search(gateway)

    expect(products.some((p) => p.inStock)).toBe(false)
  })
})

describe('TendaCatalogGateway request assembly', () => {
  it('asks the search endpoint for the term', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('leite condensado')

    const url = new URL(http.lastUrl)
    expect(url.host).toBe('api.tendaatacado.com.br')
    expect(url.pathname).toBe('/api/public/store/search')
    expect(url.searchParams.get('query')).toBe('leite condensado')
  })

  it('pins the page and the ordering', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    const params = new URL(http.lastUrl).searchParams
    expect(params.get('page')).toBe('1')
    expect(params.get('order')).toBe('relevance')
  })

  it('never sends save, which would feed their most-searched list', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(new URL(http.lastUrl).searchParams.has('save')).toBe(false)
  })

  it('sends the configured cart, which is what makes the price a branch price', async () => {
    // Measured on 2026-10-20: the same term under a the second region cart and under
    // no cart differ on 7 of 117 matched products — açúcar cristal Colombo
    // 5kg is 13.99 against 15.89. Without this parameter every branch reads
    // back São Paulo's list.
    const { gateway, http } = build(okWithFixture, { cartId: '39875841' })
    await gateway.searchTerm('arroz')

    expect(new URL(http.lastUrl).searchParams.get('cartId')).toBe('39875841')
  })

  it('omits the cart when none is configured, rather than sending an empty one', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(new URL(http.lastUrl).searchParams.has('cartId')).toBe(false)
  })

  it('identifies itself', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].options?.headers?.['User-Agent']).toMatch(/precinho-collector/)
  })

  it('reads a GET, never the disallowed HTML search page', async () => {
    // robots.txt disallows /busca?q= on the storefront; this endpoint is a
    // different host and path, and is not disallowed.
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].method).toBe('GET')
    expect(http.lastUrl).not.toContain('/busca')
  })

  it('waits out the configured gap before a second term', async () => {
    const slept: number[] = []
    let now = 0
    const { gateway } = build(okWithFixture, {
      minIntervalMs: 1_000,
      nowMs: () => now,
      sleep: async (ms) => {
        slept.push(ms)
        now += ms
      },
    })

    await gateway.searchTerm('arroz')
    await gateway.searchTerm('feijão')

    expect(slept).toEqual([1_000])
  })
})

describe('TendaCatalogGateway when the store will not answer', () => {
  it.each([
    { status: 'http-error', statusCode: 503 },
    { status: 'timeout' },
    { status: 'network-error', reason: 'ECONNRESET' },
    { status: 'invalid-json' },
  ] as const)('reports $status as unavailable', async (response) => {
    const { gateway, logger } = build(response)

    const result = await gateway.searchTerm('arroz')
    expect(result).toEqual({ status: 'unavailable', reason: response.status })
    expect(logger.find('tenda.search_failed')).toHaveLength(1)
  })

  it('reports a cart the store no longer knows as unavailable, never as a price', async () => {
    // A cart id Tenda does not recognise answers 500 — `cartId=1` and
    // `cartId=99999999` both do. The run must lose the term rather than
    // store the chain default under a branch's name, which is the exact
    // failure this parameter exists to prevent.
    const { gateway, logger } = build(
      { status: 'http-error', statusCode: 500 },
      { cartId: '39875841' },
    )

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'http-error',
    })
    expect(logger.find('tenda.search_failed')).toHaveLength(1)
  })

  it('refuses a body that is not the documented shape', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { total_pages: 0 } })

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'invalid-json',
    })
    expect(logger.find('tenda.unexpected_payload')).toHaveLength(1)
  })

  it('refuses a body that is not an object at all', async () => {
    const { gateway } = build({ status: 'ok', statusCode: 200, body: '<html>503</html>' })

    expect((await gateway.searchTerm('arroz')).status).toBe('unavailable')
  })

  it('reads a term that matches nothing as an empty result, not a failure', async () => {
    // A miss answers 200 with products: [], which is an answer.
    const body = { current_page: 1, total_pages: 0, total_products: 0, products: [] }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    expect(await gateway.searchTerm('xyzzy')).toEqual({ status: 'ok', products: [] })
  })
})

describe('TendaCatalogGateway skipping rows it cannot use', () => {
  // The live endpoint only returns priced, linked, in-stock rows, so these
  // shapes are the defensive edge rather than anything recorded.
  const degenerate = {
    products: [
      { name: 'Sem preço', url: 'https://tendaatacado.com.br/produto/sem-preco', barcode: '1' },
      {
        name: 'Preço zero',
        url: 'https://tendaatacado.com.br/produto/preco-zero',
        price: 0,
      },
      { name: 'Sem url', sku: 'x', price: 5 },
      { name: 'Url inválida', url: 'nao-e-uma-url', price: 5 },
      { url: 'https://tendaatacado.com.br/produto/sem-nome', price: 5 },
      null,
      {
        name: 'Boa',
        sku: 'ok-1',
        url: 'https://tendaatacado.com.br/produto/boa',
        price: 5,
        availability: 'in_stock',
      },
    ],
  }

  it('keeps only the row it can price and link', async () => {
    const { gateway } = build({ status: 'ok', statusCode: 200, body: degenerate })
    const products = await search(gateway)

    expect(products.map((p) => p.name)).toEqual(['Boa'])
  })

  it('reports no barcode as null rather than inventing one', async () => {
    const { gateway } = build({ status: 'ok', statusCode: 200, body: degenerate })
    const products = await search(gateway)

    expect(products[0].ean).toBeNull()
  })

  it('reports a blank barcode as null', async () => {
    const body = {
      products: [
        {
          name: 'Vazio',
          sku: 'v',
          url: 'https://tendaatacado.com.br/produto/v',
          price: 1,
          barcode: '   ',
        },
      ],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    expect((await search(gateway))[0].ean).toBeNull()
  })

  it('passes an unverifiable barcode through for the domain to reject', async () => {
    // Tenda really does put internal codes in this field: a tyre came back
    // as "7847043". Stripping it here would hide that from the domain.
    const body = {
      products: [
        {
          name: 'Pneu Sunset Enzo B2 175/75R13 84T',
          sku: '000000000001000100-UN',
          barcode: '7847043',
          url: 'https://tendaatacado.com.br/produto/pneu-sunset-enzo-b2-17575r13-84t',
          price: 269.9,
        },
      ],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })
    const products = await search(gateway)

    expect(products[0].ean).toBe('7847043')
    expect(Ean.tryParse(products[0].ean)).toBeNull()
  })

  it('falls back to the numeric id when there is no sku', async () => {
    const body = {
      products: [
        { id: 1782, name: 'Sem sku', url: 'https://tendaatacado.com.br/produto/sem-sku', price: 1 },
      ],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    expect((await search(gateway))[0].externalId).toBe('1782')
  })

  it('falls back to the first photo when there is no thumbnail', async () => {
    const body = {
      products: [
        {
          name: 'Sem thumb',
          url: 'https://tendaatacado.com.br/produto/sem-thumb',
          price: 1,
          photos: [{ url: 'https://d3gdr9n5lqb5z7.cloudfront.net/fotos/1782.jpg' }],
        },
      ],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    expect((await search(gateway))[0].imageUrl).toBe(
      'https://d3gdr9n5lqb5z7.cloudfront.net/fotos/1782.jpg',
    )
  })

  it('reports no image as null', async () => {
    const body = {
      products: [{ name: 'Sem foto', url: 'https://tendaatacado.com.br/produto/x', price: 1 }],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    expect((await search(gateway))[0].imageUrl).toBeNull()
  })
})

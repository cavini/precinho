import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HttpJsonResponse } from '@/application/ports/HttpClient'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { MagentoCatalogGateway } from '@/infrastructure/gateways/magento/MagentoCatalogGateway'
import type { MagentoStoreConfig } from '@/infrastructure/gateways/magento/MagentoCatalogGateway'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Names, SKUs and prices are Tauste's, read on 2026-10-19. */
const TAUSTE_ARROZ: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/magento-tauste-arroz.json'), 'utf8'),
)

const GRAPHQL = /\/graphql/

function build(response: HttpJsonResponse, config: Partial<MagentoStoreConfig> = {}) {
  const http = new FakeHttpClient([{ match: GRAPHQL, response }])
  const logger = new RecordingLogger()
  const gateway = new MagentoCatalogGateway(
    { storeId: 'tauste', host: 'tauste.com.br', ...config },
    http,
    logger,
  )
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 200, body: TAUSTE_ARROZ } as const

describe('MagentoCatalogGateway against a recorded Tauste response', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products).toHaveLength(3)
  })

  it('reads name, price and stock', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0]).toMatchObject({
      name: 'Arroz Tio João Integral Cozinha Fácil com 1kg',
      externalId: '138033',
      priceReais: 11.79,
      listPriceReais: 13.49,
      inStock: true,
    })
  })

  it('builds a product link from the url key', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0].url).toBe(
      'https://tauste.com.br/arroz-tio-joao-integral-cozinha-facil-1kg.html',
    )
  })

  it('marks an out-of-stock product rather than dropping it', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[2].inStock).toBe(false)
  })

  it('treats a regular price equal to the final price as no promotion', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[1].listPriceReais).toBeNull()
  })

  it('reports no barcode, because the schema publishes none', async () => {
    // Magento keeps EAN as a custom attribute and this store does not expose
    // one, so these products cannot merge across stores on a verified GTIN.
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.every((p) => p.ean === null)).toBe(true)
  })

  it('still yields a size the domain can read from the name', async () => {
    // Without a barcode, the size is what makes an approximate match safe.
    const parser = new ProductNameParser()
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(parser.extractSize(result.products[2].name)).toEqual({ amount: 5, unit: 'kg' })
  })
})

describe('MagentoCatalogGateway request assembly', () => {
  it('escapes the search term into the GraphQL literal', async () => {
    // A quote in the term must not break out of the query string.
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz "especial"')

    const query = new URL(http.lastUrl).searchParams.get('query') ?? ''
    expect(query).toContain(String.raw`search: "arroz \"especial\""`)
  })

  it('asks for the configured page size', async () => {
    const { gateway, http } = build(okWithFixture, { pageSize: 5 })
    await gateway.searchTerm('arroz')

    expect(new URL(http.lastUrl).searchParams.get('query')).toContain('pageSize: 5')
  })

  it('sends the store view, which is how the chain prices per city', async () => {
    const { gateway, http } = build(okWithFixture, { storeView: 'marilia' })
    await gateway.searchTerm('arroz')

    expect(http.requests[0].options?.headers?.Store).toBe('marilia')
  })

  it('omits the store view header when there is none', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].options?.headers?.Store).toBeUndefined()
  })

  it('identifies itself', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].options?.headers?.['User-Agent']).toMatch(/precinho-collector/)
  })
})

describe('MagentoCatalogGateway when the store will not answer', () => {
  it('treats a GraphQL error as unavailable, despite the 200', async () => {
    // GraphQL reports failure in the body, so a broken query looks like a
    // success at the HTTP layer.
    const body = { errors: [{ message: 'Cannot query field "ean" on type "ProductInterface".' }] }
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('arroz')
    expect(result.status).toBe('unavailable')
    expect(logger.find('magento.graphql_error')).toHaveLength(1)
  })

  it.each([
    { status: 'http-error', statusCode: 503 },
    { status: 'timeout' },
    { status: 'network-error', reason: 'ECONNRESET' },
  ] as const)('reports $status as unavailable', async (response) => {
    const { gateway } = build(response)
    expect((await gateway.searchTerm('arroz')).status).toBe('unavailable')
  })

  it('refuses a body that is not the documented shape', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { data: {} } })

    expect((await gateway.searchTerm('arroz')).status).toBe('unavailable')
    expect(logger.find('magento.unexpected_payload')).toHaveLength(1)
  })

  it('skips an item with no price rather than failing the batch', async () => {
    const body = {
      data: {
        products: {
          items: [
            { name: 'Sem preço', url_key: 'sem-preco', price_range: { minimum_price: {} } },
            { name: 'Sem url', sku: 'x', price_range: { minimum_price: { final_price: { value: 5 } } } },
            { name: 'Boa', url_key: 'boa', stock_status: 'IN_STOCK', price_range: { minimum_price: { final_price: { value: 5 } } } },
          ],
        },
      },
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('arroz')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.map((p) => p.name)).toEqual(['Boa'])
  })
})

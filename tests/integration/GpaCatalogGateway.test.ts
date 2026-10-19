import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HttpJsonResponse } from '@/application/ports/HttpClient'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { GpaCatalogGateway } from '@/infrastructure/gateways/gpa/GpaCatalogGateway'
import type { GpaStoreConfig } from '@/infrastructure/gateways/gpa/GpaCatalogGateway'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Recorded from api.vendas.gpa.digital on 2026-10-19. */
const GPA_ARROZ: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/gpa-pa-arroz.json'), 'utf8'),
)

const SEARCH = /search\/search/

function build(response: HttpJsonResponse, config: Partial<GpaStoreConfig> = {}) {
  const http = new FakeHttpClient([{ match: SEARCH, response }])
  const logger = new RecordingLogger()
  const gateway = new GpaCatalogGateway(
    { storeId: 'paodeacucar', banner: 'pa', gpaStoreId: 461, ...config },
    http,
    logger,
  )
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 200, body: GPA_ARROZ } as const

describe('GpaCatalogGateway against a recorded response', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products).toHaveLength(3)
  })

  it('reads the fields a comparison needs', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0]).toMatchObject({
      name: 'Arroz Agulhinha Tipo 1 CAMIL Pacote 5kg',
      brand: 'CAMIL',
      priceReais: 31.99,
      inStock: true,
      url: 'https://www.paodeacucar.com/produto/41329/arroz-agulhinha-tipo-1-camil-pacote-5kg',
    })
  })

  it('absolutises the image path, which arrives site-relative', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0].imageUrl).toBe(
      'https://static.paodeacucar.com/img/uploads/1/224/33031224.jpg',
    )
  })

  it('reports no barcode, because GPA publishes none', async () => {
    // sku is an internal code and attributes come back empty, so these
    // products depend on the approximate matcher to be compared at all.
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.every((p) => p.ean === null)).toBe(true)
  })

  it('leaves a size in the name for the domain to read', async () => {
    const parser = new ProductNameParser()
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('arroz')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(parser.extractSize(result.products[1].name)).toEqual({ amount: 1, unit: 'kg' })
  })
})

describe('GpaCatalogGateway request', () => {
  it('posts the search, because this API takes no query string', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].method).toBe('POST')
    expect(http.lastUrl).toBe('https://api.vendas.gpa.digital/pa/search/search')
  })

  it('sends the term and the page size', async () => {
    const { gateway, http } = build(okWithFixture, { pageSize: 5 })
    await gateway.searchTerm('leite condensado')

    expect(http.lastBody).toMatchObject({ terms: 'leite condensado', resultsPerPage: 5, page: 1 })
  })

  it('sends the store, which is how GPA regionalises', async () => {
    const { gateway, http } = build(okWithFixture, { gpaStoreId: 1234 })
    await gateway.searchTerm('arroz')

    expect(http.lastBody).toMatchObject({ storeId: 1234 })
  })

  it('never sends a userHash', async () => {
    // The browser sends a per-person identifier. The catalogue answers fine
    // without it, and a nightly collector has no business carrying one.
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.lastBody).not.toHaveProperty('userHash')
    expect(JSON.stringify(http.lastBody)).not.toMatch(/hash/i)
  })

  it('targets the configured banner', async () => {
    const { gateway, http } = build(okWithFixture, { banner: 'ex' })
    await gateway.searchTerm('arroz')

    expect(http.lastUrl).toContain('/ex/search/search')
  })

  it('identifies itself', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('arroz')

    expect(http.requests[0].options?.headers?.['User-Agent']).toMatch(/precinho-collector/)
  })
})

describe('GpaCatalogGateway when GPA will not answer', () => {
  it.each([
    { status: 'http-error', statusCode: 404 },
    { status: 'http-error', statusCode: 500 },
    { status: 'timeout' },
    { status: 'network-error', reason: 'ECONNRESET' },
  ] as const)('reports $status as unavailable', async (response) => {
    const { gateway, logger } = build(response)

    expect((await gateway.searchTerm('arroz')).status).toBe('unavailable')
    expect(logger.find('gpa.search_failed')).toHaveLength(1)
  })

  it('refuses a body with no product list', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { totalProducts: 0 } })

    expect((await gateway.searchTerm('arroz')).status).toBe('unavailable')
    expect(logger.find('gpa.unexpected_payload')).toHaveLength(1)
  })

  it('skips rows it cannot price or link', async () => {
    const body = {
      products: [
        { id: 1, name: 'Sem preço', urlDetails: 'https://x.com/p' },
        { id: 2, name: 'Preço zero', urlDetails: 'https://x.com/p', price: 0 },
        { id: 3, name: 'Sem link', price: 5 },
        { id: 4, name: 'Boa', urlDetails: 'https://x.com/p4', price: 5, stock: true },
        null,
      ],
    }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('arroz')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.map((p) => p.name)).toEqual(['Boa'])
  })

  it('treats a missing stock flag as available rather than hiding the price', async () => {
    const body = { products: [{ id: 1, name: 'Sem flag', urlDetails: 'https://x.com/p', price: 5 }] }
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('arroz')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0].inStock).toBe(true)
  })
})

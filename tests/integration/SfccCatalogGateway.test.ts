import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { SfccCatalogGateway } from '@/infrastructure/gateways/sfcc/SfccCatalogGateway'
import type { SfccStoreConfig } from '@/infrastructure/gateways/sfcc/SfccCatalogGateway'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Names and prices are Nagumo's, read on 2026-10-19. */
const NAGUMO_ARROZ: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/nagumo-arroz-search.json'), 'utf8'),
)

/** The same chain's second region's branch, where the Momiji 5kg is ten reais cheaper. */
const NAGUMO_MOMIJI: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/nagumo-momiji-taubate-search.json'), 'utf8'),
)

const SELECT_STORE = /Stores-SelectStore/
const SEARCH = /Search-UpdateGrid/

const DWSID = 'FqMUCUv9xDx6LitjcqEJDS--UEkCgVndqoRw7-ujKdaE-bTMzGb7ww=='

/** Demandware answers ten Set-Cookie headers; Node folds them into one string. */
const selectStoreOk = {
  status: 'ok',
  statusCode: 200,
  body: { action: 'Stores-SelectStore', success: true },
  headers: {
    'set-cookie':
      `dwsid=${DWSID}; path=/; HttpOnly; Secure; SameSite=None, ` +
      'dw_store=25; path=/; Secure, hasSelectedStore=25; path=/; Secure',
  },
} as const

const BASE: SfccStoreConfig = {
  storeId: 'nagumo-taubate',
  host: 'www.nagumo.com.br',
  siteId: 'Nagumo',
  sfccStoreId: '25',
}

function build(response: FakeResponse, config: Partial<SfccStoreConfig> = {}) {
  const http = new FakeHttpClient([
    { match: SELECT_STORE, response: selectStoreOk },
    { match: SEARCH, response },
  ])
  const logger = new RecordingLogger()
  const gateway = new SfccCatalogGateway({ ...BASE, ...config }, http, logger)
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 200, body: NAGUMO_ARROZ } as const

/** Fails the test rather than letting an unavailable result read as empty. */
async function search(gateway: SfccCatalogGateway, term = 'arroz') {
  const result = await gateway.searchTerm(term)
  if (result.status !== 'ok') throw new Error(result.reason)
  return result.products
}

describe('SfccCatalogGateway against a recorded Nagumo response', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    expect(await search(gateway)).toHaveLength(4)
  })

  it('reads name, brand, price and the store-side id', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0]).toMatchObject({
      name: 'Arroz Branco Tipo 1 Camil 5Kg',
      externalId: '293303',
      brand: 'CAMIL',
      priceReais: 23.7,
      inStock: true,
    })
  })

  it('publishes no barcode, so these rows stay store-local', async () => {
    // Nagumo's search row carries no GTIN anywhere — customAttributes comes
    // back empty and datasheet null — so its products only ever merge
    // through the approximate matcher, exactly as GPA's do.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.every((product) => product.ean === null)).toBe(true)
  })

  it('takes the canonical product link the catalogue publishes', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].url).toBe(
      'https://www.nagumo.com.br/categoria/departamentos/basicos-e-matinais/commodities/arroz/arroz-branco-tipo-1-camil-5kg-293303.html',
    )
  })

  it('takes the image from the asset host, not the rewriter in front of it', async () => {
    // SFCC's absURL wraps the real blob URL in a /on/demandware.static/
    // path; disUrl is the asset itself and is a third the length.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].imageUrl).toBe(
      'https://ngostpubprd001.blob.core.windows.net/produtos/assets/ofertas-ecommerce/293303.webp',
    )
  })

  it('reports no list price, because the catalogue publishes none', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.every((product) => product.listPriceReais === null)).toBe(true)
  })

  it('trusts the availability flag over the stock count behind it', async () => {
    // Three of these carry a non-zero ATSInCurrentStore and are still
    // flagged unavailable at the second region's branch. The flag is what the
    // shop's own page honours — it shows "Produto Indisponível" on all
    // three — so counting stock instead would list things nobody can buy.
    const { gateway } = build({ status: 'ok', statusCode: 200, body: NAGUMO_MOMIJI })
    const products = await search(gateway)

    expect(products.map((product) => product.inStock)).toEqual([true, false, false, false])
  })

  it('prices from the branch it was told to, which is the whole point', async () => {
    // Store 25 is the second region and quotes 49.90 for the Momiji 5kg; stores 7, 46
    // and 20 around São Paulo all quote 59.90. Verified against the shop's
    // own storefront after switching its branch selector to the second region.
    const { gateway } = build({ status: 'ok', statusCode: 200, body: NAGUMO_MOMIJI })
    const products = await search(gateway)

    expect(products[0]).toMatchObject({ name: 'Arroz T 1 Momiji 5Kg', priceReais: 49.9 })
  })

  it('opens a session on the configured branch before searching', async () => {
    const { gateway, http } = build(okWithFixture, { sfccStoreId: '25' })
    await search(gateway)

    expect(http.requests[0].url).toBe(
      'https://www.nagumo.com.br/on/demandware.store/Sites-Nagumo-Site/pt_BR/Stores-SelectStore?storeId=25',
    )
  })

  it('carries the session cookie on the search, or it gets the default branch', async () => {
    // The branch lives in Demandware's server-side session, not in the
    // dw_store cookie: replaying dw_store alone returned 59.90 for a
    // product the chosen branch sells at 49.90.
    const { gateway, http } = build(okWithFixture)
    await search(gateway)

    expect(http.requests[1].options?.headers?.Cookie).toBe(`dwsid=${DWSID}; dw_store=25`)
  })

  it('opens the session once and reuses it across terms', async () => {
    const { gateway, http } = build(okWithFixture)
    await search(gateway, 'arroz')
    await search(gateway, 'leite')

    expect(http.requests.filter((request) => SELECT_STORE.test(request.url))).toHaveLength(1)
  })

  it('asks for one page of the configured width', async () => {
    const { gateway, http } = build(okWithFixture, { pageSize: 36 })
    await search(gateway)

    expect(http.lastUrl).toContain('q=arroz&start=0&sz=36')
  })

  it('reports unavailable when the branch session cannot be opened', async () => {
    // Without a session the catalogue would answer for whichever branch
    // Demandware defaults to, and those are not this region's prices.
    const http = new FakeHttpClient([
      { match: SELECT_STORE, response: { status: 'http-error', statusCode: 500 } },
    ])
    const logger = new RecordingLogger()
    const gateway = new SfccCatalogGateway(BASE, http, logger)

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'no-store-session',
    })
    expect(logger.find('sfcc.store_session_failed')).toHaveLength(1)
  })

  it('refuses to search when the session carries no cookie to identify it', async () => {
    const http = new FakeHttpClient([
      {
        match: SELECT_STORE,
        response: { status: 'ok', statusCode: 200, body: { success: true }, headers: {} },
      },
    ])
    const gateway = new SfccCatalogGateway(BASE, http, new RecordingLogger())

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'no-store-session',
    })
  })

  it('reports unavailable when the catalogue refuses', async () => {
    const { gateway } = build({ status: 'http-error', statusCode: 503 })

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'http-error',
    })
  })

  it('reports unavailable rather than empty when the payload changes shape', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { count: 3 } })

    expect(await gateway.searchTerm('arroz')).toEqual({
      status: 'unavailable',
      reason: 'invalid-json',
    })
    expect(logger.find('sfcc.unexpected_payload')).toHaveLength(1)
  })

  it('drops a row it cannot price', async () => {
    const { gateway } = build({
      status: 'ok',
      statusCode: 200,
      body: {
        productsSearchResult: [
          { id: '1', productName: 'Fantasma', price: { sales: { value: 0 } } },
        ],
      },
    })

    expect(await search(gateway)).toEqual([])
  })
})

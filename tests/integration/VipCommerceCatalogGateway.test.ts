import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { Ean } from '@/domain/value-objects/Ean'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { VipCommerceCatalogGateway } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import type { VipCommerceStoreConfig } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import type { FakeResponse } from '@/infrastructure/testing/FakeHttpClient'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/** Names, barcodes and prices are Shibata's the second region shelf, read on 2026-10-19. */
const SHIBATA_CAFE: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/shibata-cafe-search.json'), 'utf8'),
)

const LOGIN = /auth\/loja\/login/
const SEARCH = /buscas\/produtos\/termo/
const REGION = /centros_distribuicoes\/cep/

const TOKEN = 'eyJhbGciOiJIUzUxMiJ9.anonymous.signature'
const loginOk = { status: 'ok', statusCode: 200, body: { success: true, data: TOKEN } } as const

const BASE: VipCommerceStoreConfig = {
  storeId: 'shibata-taubate',
  organizationId: '161',
  branchId: '1',
  distributionCenterId: '10',
  domainKey: 'loja.shibata.com.br',
  storefrontHost: 'www.loja.shibata.com.br',
}

function build(response: FakeResponse, config: Partial<VipCommerceStoreConfig> = {}) {
  const http = new FakeHttpClient([
    { match: LOGIN, response: loginOk },
    { match: SEARCH, response },
  ])
  const logger = new RecordingLogger()
  const gateway = new VipCommerceCatalogGateway({ ...BASE, ...config }, http, logger)
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 200, body: SHIBATA_CAFE } as const

/** Fails the test rather than letting an unavailable result read as empty. */
async function search(gateway: VipCommerceCatalogGateway, term = 'cafe') {
  const result = await gateway.searchTerm(term)
  if (result.status !== 'ok') throw new Error(result.reason)
  return result.products
}

describe('VipCommerceCatalogGateway against a recorded Shibata response', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    expect(await search(gateway)).toHaveLength(4)
  })

  it('reads name, price, stock and the store-side id', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0]).toMatchObject({
      name: 'Café em Cápsula Torrado e Moído Caffè Matinal Nescafé Dolce Gusto Caixa - 80g',
      externalId: '38598',
      priceReais: 22.9,
      inStock: true,
    })
  })

  it('publishes a barcode the domain will verify', async () => {
    // What lets Shibata's rows merge with another chain's on a GTIN rather
    // than falling back to the approximate matcher.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products.map((p) => p.ean)).toEqual([
      '7891000621981',
      '7896089012019',
      '7896045102440',
      '7891018427650',
    ])
    expect(products.every((p) => Ean.tryParse(p.ean) !== null)).toBe(true)
  })

  it('takes the struck-out price from the offer, not from preco_original', async () => {
    // Shibata leaves preco_original at 0 and exibe_preco_original false even
    // on a product that is plainly discounted; the previous price lives in
    // oferta.preco_antigo. Reading the obvious field would have reported
    // every promotion as no promotion at all.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[2]).toMatchObject({ priceReais: 23.29, listPriceReais: 23.6 })
  })

  it('reports no list price where nothing is struck out', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].listPriceReais).toBeNull()
  })

  it('builds a product link on the canonical route, not the legacy one', async () => {
    // /produtos/detalhe/ still resolves, but the app's own router answers
    // it with redirectTo: "produto/:id/:slug" and robots.txt files it under
    // "Redirecionamentos e URLs Legadas". Storing it would hand every
    // shopper a redirect to a path the shop is retiring.
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].url).toBe(
      'https://www.loja.shibata.com.br/produto/38598/cafe-em-capsula-torrado-e-moido-caffe-matinal-nescafe-dolce-gusto-caixa-80g',
    )
  })

  it('builds the image URL on the product asset bucket', async () => {
    const { gateway } = build(okWithFixture)
    const products = await search(gateway)

    expect(products[0].imageUrl).toBe(
      'https://produto-assets-vipcommerce-com-br.br-se1.magaluobjects.com/250x250/8326f578-6a9e-48be-bda2-82611ee50461.jpg',
    )
  })

  it('asks the configured distribution centre, because that is the region', async () => {
    const { gateway, http } = build(okWithFixture, { distributionCenterId: '10' })
    await search(gateway)

    expect(http.lastUrl).toContain('/filial/1/centro_distribuicao/10/loja/buscas/produtos/termo/')
  })

  it('mints the anonymous token once and reuses it', async () => {
    // A token per term would triple a sweep's requests against a host that
    // is shared with every other chain on the platform.
    const { gateway, http } = build(okWithFixture)
    await search(gateway, 'cafe')
    await search(gateway, 'arroz')

    expect(http.requests.filter((request) => LOGIN.test(request.url))).toHaveLength(1)
  })

  it('sends the tenant headers the shared API refuses to answer without', async () => {
    const { gateway, http } = build(okWithFixture)
    await search(gateway)

    expect(http.lastUrl).toContain('services.vipcommerce.com.br')
    expect(http.requests[http.requests.length - 1].options?.headers).toMatchObject({
      OrganizationId: '161',
      DomainKey: 'loja.shibata.com.br',
      Authorization: `Bearer ${TOKEN}`,
    })
  })

  it('replaces the characters the storefront replaces in a term', async () => {
    // The term goes in the path, not the query string, so a slash or a
    // space would otherwise change which endpoint is addressed.
    const { gateway, http } = build(okWithFixture)
    await search(gateway, 'queijo mussarela')

    expect(http.lastUrl).toContain('/termo/queijo+mussarela')
  })

  it('reports unavailable when the catalogue refuses', async () => {
    const { gateway } = build({ status: 'http-error', statusCode: 503 })

    expect(await gateway.searchTerm('cafe')).toEqual({
      status: 'unavailable',
      reason: 'http-error',
    })
  })

  it('reports unavailable rather than empty when the payload changes shape', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { data: {} } })

    expect(await gateway.searchTerm('cafe')).toEqual({
      status: 'unavailable',
      reason: 'invalid-json',
    })
    expect(logger.find('vipcommerce.unexpected_payload')).toHaveLength(1)
  })

  it('reports unavailable when the token cannot be minted', async () => {
    const http = new FakeHttpClient([
      { match: LOGIN, response: { status: 'http-error', statusCode: 401 } },
    ])
    const gateway = new VipCommerceCatalogGateway(BASE, http, new RecordingLogger())

    expect(await gateway.searchTerm('cafe')).toEqual({
      status: 'unavailable',
      reason: 'unauthenticated',
    })
  })

  it('drops a row it cannot price', async () => {
    const { gateway } = build({
      status: 'ok',
      statusCode: 200,
      body: {
        data: { produtos: [{ produto_id: 1, descricao: 'Fantasma', preco: '0', link: 'x' }] },
      },
    })

    expect(await search(gateway)).toEqual([])
  })
})

describe('VipCommerceCatalogGateway resolving a region', () => {
  function buildResolver(response: FakeResponse) {
    const http = new FakeHttpClient([
      { match: LOGIN, response: loginOk },
      { match: REGION, response },
    ])
    return new VipCommerceCatalogGateway(BASE, http, new RecordingLogger())
  }

  it('names the distribution centre that serves a CEP', async () => {
    const gateway = buildResolver({
      status: 'ok',
      statusCode: 200,
      body: { success: true, data: [{ id: 10, nome: 'H-03 - Taubaté' }] },
    })

    expect(await gateway.resolveRegion(PostalCode.tryParse('12010000')!)).toEqual({
      regionToken: '10',
      sellerIds: ['10'],
    })
  })

  it('returns null where the chain does not deliver', async () => {
    // The control that makes the answer mean something: Shibata answers an
    // empty list for Rio Branco, Acre, rather than falling back to a
    // default centre. A chain that answered the same for Acre as for
    // the second region would be telling us nothing about coverage.
    const gateway = buildResolver({
      status: 'ok',
      statusCode: 200,
      body: { success: true, data: [] },
    })

    expect(await gateway.resolveRegion(PostalCode.tryParse('69900000')!)).toBeNull()
  })

  it('returns null when the endpoint refuses', async () => {
    const gateway = buildResolver({ status: 'http-error', statusCode: 500 })

    expect(await gateway.resolveRegion(PostalCode.tryParse('12010000')!)).toBeNull()
  })
})

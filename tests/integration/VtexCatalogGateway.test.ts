import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { VtexCatalogGateway } from '@/infrastructure/gateways/vtex/VtexCatalogGateway'
import { FakeHttpClient } from '@/infrastructure/testing/FakeHttpClient'

/**
 * Recorded from www.mambo.com.br on 2026-10-19. Shape and values are the
 * store's, not invented — the point of this test is that the mapping
 * survives a real payload, including an 8-digit barcode and a 99999 stock
 * figure.
 */
const MAMBO_COCA_COLA: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/vtex-legacy-mambo-coca-cola.json'), 'utf8'),
)

const CATALOG = /catalog_system\/pub\/products\/search/
const REGIONS = /checkout\/pub\/regions/

function build(
  response: Parameters<typeof FakeHttpClient>[0][number]['response'],
  config: Partial<ConstructorParameters<typeof VtexCatalogGateway>[0]> = {},
) {
  const http = new FakeHttpClient([{ match: CATALOG, response }])
  const logger = new RecordingLogger()
  const gateway = new VtexCatalogGateway(
    { storeId: 'mambo', host: 'www.mambo.com.br', ...config },
    http,
    logger,
  )
  return { gateway, http, logger }
}

const okWithFixture = { status: 'ok', statusCode: 206, body: MAMBO_COCA_COLA } as const

describe('VtexCatalogGateway against a recorded Mambo payload', () => {
  it('maps every priced product', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('coca-cola')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products).toHaveLength(3)
  })

  it('reads the fields a comparison needs', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('coca-cola')

    if (result.status !== 'ok') throw new Error(result.reason)
    const can = result.products.find((p) => p.name.includes('Lata'))!

    expect(can.ean).toBe('7894900010015')
    expect(can.priceReais).toBe(3.99)
    expect(can.inStock).toBe(true)
    // Raw, as the store wrote it. Tidying the casing is the domain's job,
    // not the gateway's — see the assertion below.
    expect(can.brand).toBe('Coca-cola')
    expect(can.url).toMatch(/^https:\/\/www\.mambo\.com\.br\//)
    expect(can.imageUrl).toMatch(/^https:\/\//)
    expect(can.externalId).toBeTruthy()
  })

  it('leaves brand casing for the domain to tidy', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('coca-cola')

    if (result.status !== 'ok') throw new Error(result.reason)
    const parser = new ProductNameParser()
    expect(parser.normalizeBrand(result.products[0].brand)).toBe('Coca-Cola')
  })

  it('passes an 8-digit barcode through for the domain to judge', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('coca-cola')

    if (result.status !== 'ok') throw new Error(result.reason)
    const glass = result.products.find((p) => p.name.includes('Vidro'))!
    expect(glass.ean).toBe('78912908')
  })

  it('treats a stock figure above zero as available', async () => {
    const { gateway } = build(okWithFixture)
    const result = await gateway.searchTerm('coca-cola')

    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.every((product) => product.inStock)).toBe(true)
  })
})

describe('VtexCatalogGateway mapping rules', () => {
  it('drops a zero-priced row instead of reporting a free product', async () => {
    // VTEX reports an unlisted or unpriced item as Price 0 rather than
    // leaving it out.
    const body = [
      {
        productId: '1',
        productName: 'Sem preço',
        link: 'https://www.mambo.com.br/sem-preco/p',
        items: [{ ean: '7894900010015', sellers: [{ commertialOffer: { Price: 0, AvailableQuantity: 5 } }] }],
      },
    ]
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('x')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products).toEqual([])
  })

  it('marks a product with no stock as out of stock rather than dropping it', async () => {
    // It still belongs on the detail screen, greyed out.
    const body = [
      {
        productId: '1',
        productName: 'Esgotado',
        link: 'https://www.mambo.com.br/esgotado/p',
        items: [{ ean: '7894900010015', sellers: [{ commertialOffer: { Price: 9.9, AvailableQuantity: 0 } }] }],
      },
    ]
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('x')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products[0].inStock).toBe(false)
  })

  it('only calls a higher list price a promotion', async () => {
    const body = [
      {
        productId: '1',
        productName: 'Promo',
        link: 'https://x.com/p',
        items: [{ sellers: [{ commertialOffer: { Price: 10, ListPrice: 14.98, AvailableQuantity: 1 } }] }],
      },
      {
        productId: '2',
        productName: 'Sem promo',
        link: 'https://x.com/p2',
        items: [{ sellers: [{ commertialOffer: { Price: 10, ListPrice: 10, AvailableQuantity: 1 } }] }],
      },
      {
        productId: '3',
        productName: 'Lista menor que preço',
        link: 'https://x.com/p3',
        items: [{ sellers: [{ commertialOffer: { Price: 10, ListPrice: 8, AvailableQuantity: 1 } }] }],
      },
    ]
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('x')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products.map((p) => p.listPriceReais)).toEqual([14.98, null, null])
  })

  it('skips rows missing the parts it needs rather than throwing', async () => {
    const body = [
      {},
      { productId: '1', productName: 'No items', link: 'https://x.com/p' },
      { productId: '2', productName: 'No sellers', link: 'https://x.com/p', items: [{}] },
      { productId: '3', productName: 'No link', items: [{ sellers: [{ commertialOffer: { Price: 5, AvailableQuantity: 1 } }] }] },
      null,
      'nonsense',
    ]
    const { gateway } = build({ status: 'ok', statusCode: 200, body })

    const result = await gateway.searchTerm('x')
    if (result.status !== 'ok') throw new Error(result.reason)
    expect(result.products).toEqual([])
  })
})

describe('VtexCatalogGateway when a store will not answer', () => {
  it.each([
    { status: 'http-error', statusCode: 503 },
    { status: 'timeout' },
    { status: 'network-error', reason: 'ECONNRESET' },
    { status: 'invalid-json' },
  ] as const)('reports $status as unavailable rather than throwing', async (response) => {
    const { gateway, logger } = build(response)

    const result = await gateway.searchTerm('coca-cola')
    expect(result.status).toBe('unavailable')
    // A store going quiet during a run has to be visible afterwards.
    expect(logger.find('vtex.search_failed')).toHaveLength(1)
  })

  it('refuses a body that is not the array the API promises', async () => {
    const { gateway, logger } = build({ status: 'ok', statusCode: 200, body: { products: [] } })

    const result = await gateway.searchTerm('coca-cola')
    expect(result.status).toBe('unavailable')
    expect(logger.find('vtex.unexpected_payload')).toHaveLength(1)
  })
})

describe('VtexCatalogGateway request assembly', () => {
  it('asks for a page of products', async () => {
    const { gateway, http } = build(okWithFixture, { pageSize: 10 })
    await gateway.searchTerm('coca cola')

    expect(http.lastUrl).toContain('ft=coca+cola')
    expect(http.lastUrl).toContain('_from=0')
    expect(http.lastUrl).toContain('_to=9')
  })

  it('pins the sales channel and trading area when configured', async () => {
    // Without the area token the catalogue answers with default-area prices,
    // which are not the prices a shopper at this CEP would pay.
    const { gateway, http } = build(okWithFixture, { salesChannel: '2', regionToken: 'v2.ABC' })
    await gateway.searchTerm('leite')

    expect(http.lastUrl).toContain('sc=2')
    expect(http.lastUrl).toContain('regionId=v2.ABC')
  })

  it('escapes a search term instead of pasting it into the url', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('leite & cia 100%')

    expect(http.lastUrl).toContain('ft=leite+%26+cia+100%25')
  })

  it('identifies itself', async () => {
    const { gateway, http } = build(okWithFixture)
    await gateway.searchTerm('leite')

    expect(http.requests[0].options?.headers?.['User-Agent']).toMatch(/precinho-collector/)
  })
})

describe('VtexCatalogGateway resolving a trading area from a CEP', () => {
  function withRegions(response: Parameters<typeof FakeHttpClient>[0][number]['response']) {
    const http = new FakeHttpClient([{ match: REGIONS, response }])
    const gateway = new VtexCatalogGateway(
      { storeId: 'savegnago', host: 'www.savegnago.com.br' },
      http,
      new RecordingLogger(),
    )
    return { gateway, http }
  }

  it('reads the area token and the branch that serves the CEP', async () => {
    // Recorded from Savegnago for a Ribeirão Preto CEP.
    const body = [
      {
        id: 'v2.4B7D7A57535F54B15C2B3065AB131AC9',
        sellers: [{ id: 'savegnagoioribeiraopreto08', name: 'savegnagoioribeiraopreto08' }],
      },
    ]
    const { gateway, http } = withRegions({ status: 'ok', statusCode: 200, body })

    const resolved = await gateway.resolveRegion(PostalCode.tryParse('14020000')!)
    expect(resolved?.regionToken).toBe('v2.4B7D7A57535F54B15C2B3065AB131AC9')
    expect(resolved?.sellerIds).toEqual(['savegnagoioribeiraopreto08'])
    expect(http.lastUrl).toContain('postalCode=14020000')
  })

  it('copes with an area that names no branch', async () => {
    // Zona Sul answers like this; the token is still usable.
    const { gateway } = withRegions({ status: 'ok', statusCode: 200, body: [{ id: 'U1cj', sellers: [] }] })

    const resolved = await gateway.resolveRegion(PostalCode.tryParse('22071900')!)
    expect(resolved?.regionToken).toBe('U1cj')
    expect(resolved?.sellerIds).toEqual([])
  })

  it.each([
    { label: 'an empty list', response: { status: 'ok', statusCode: 200, body: [] } },
    { label: 'no id', response: { status: 'ok', statusCode: 200, body: [{ sellers: [] }] } },
    { label: 'an http error', response: { status: 'http-error', statusCode: 404 } },
  ] as const)('returns null for $label', async ({ response }) => {
    const { gateway } = withRegions(response)
    expect(await gateway.resolveRegion(PostalCode.tryParse('14020000')!)).toBeNull()
  })
})

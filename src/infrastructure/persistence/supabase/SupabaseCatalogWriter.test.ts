import { describe, expect, it } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import type { ProductUpsert } from '@/application/ports/CatalogWriter'
import { FakeSupabaseClient } from '@/infrastructure/testing/FakeSupabaseClient'
import { SupabaseCatalogWriter } from './SupabaseCatalogWriter'

function aProduct(overrides: Partial<ProductUpsert> = {}): ProductUpsert {
  return {
    matchKey: 'pkg:sabonete-barra-vegetal-odor-de-rosas-phebo-envoltorio-90g:0.09kg',
    gtin14: null,
    name: 'Sabonete Barra Vegetal Odor de Rosas Phebo Envoltório 90g',
    description: null,
    brand: 'Phebo',
    sizeAmount: 0.09,
    sizeUnit: 'kg',
    imageUrl: null,
    searchText: 'sabonete barra vegetal odor de rosas phebo',
    ...overrides,
  }
}

function build(
  names: Array<[string, string]> = [],
  aliases: Array<[string, string]> = [],
  rpcFails: string | null = null,
) {
  const client = new FakeSupabaseClient(new Map(names), new Map(aliases), rpcFails)
  const logger = new RecordingLogger()
  const writer = new SupabaseCatalogWriter(client.asClient(), logger)
  return { writer, client, logger }
}

describe('SupabaseCatalogWriter recognising a product already here', () => {
  it('attaches to the product that already goes by that name', async () => {
    // A merge deletes the absorbed row and its key. Without this the shop
    // that published that name recreates the row the merge removed, and a
    // day of judging is undone by the next sweep.
    const product = aProduct()
    const { writer, client } = build([[product.name, 'survivor-id']])

    const ids = await writer.upsertProducts([product])

    expect(ids.get(product.matchKey)).toBe('survivor-id')
    expect(client.upserted).toHaveLength(0)
  })

  it('attaches to the product that absorbed its match key', async () => {
    const product = aProduct()
    const { writer, client } = build([], [[product.matchKey, 'survivor-id']])

    const ids = await writer.upsertProducts([product])

    expect(ids.get(product.matchKey)).toBe('survivor-id')
    expect(client.upserted).toHaveLength(0)
  })

  it('creates a product nobody has seen before', async () => {
    const product = aProduct()
    const { writer, client } = build()

    const ids = await writer.upsertProducts([product])

    expect(client.upserted).toHaveLength(1)
    expect(ids.get(product.matchKey)).toBe('new-0')
  })

  it('asks through rpc, so the list travels in a body rather than a URL', async () => {
    // Two hundred product names in an `in (...)` make a URL long enough
    // that fetch refuses to send it, and the error says only "fetch
    // failed". One run recreated 6,707 rows that way and reported success.
    const { writer, client } = build()
    await writer.upsertProducts([aProduct()])

    expect(client.rpcCalls.map((call) => call.name).sort()).toEqual([
      'resolve_product_aliases',
      'resolve_product_names',
    ])
  })

  it('carries long names through intact', async () => {
    // The names that broke the URL were the ordinary ones: sixty
    // characters each, five hundred of them.
    const many = Array.from({ length: 500 }, (_, index) =>
      aProduct({
        matchKey: `pkg:produto-${index}:1kg`,
        name: `Produto Com Nome Razoavelmente Comprido Para Um Catalogo ${index}`,
      }),
    )
    const { writer, client } = build()

    await writer.upsertProducts(many)

    const asked = client.rpcCalls
      .filter((call) => call.name === 'resolve_product_names')
      .flatMap((call) => call.args.p_names as string[])

    expect(asked).toHaveLength(500)
  })

  it('says so at error level when the lookup fails', async () => {
    // Failing open here undoes a day of judging while the run still
    // reports success, so it cannot be a warning in a log nobody reads.
    const { writer, logger } = build([], [], 'TypeError: fetch failed')

    await writer.upsertProducts([aProduct()])

    const complaints = logger.lines.filter((line) => line.level === 'error')
    expect(complaints.map((line) => line.message)).toContain('collector.names_unreadable')
  })

  it('still writes prices when the lookup fails', async () => {
    // A duplicate row is recoverable; a day with no prices is not.
    const { writer, client } = build([], [], 'TypeError: fetch failed')

    await writer.upsertProducts([aProduct()])

    expect(client.upserted).toHaveLength(1)
  })
})

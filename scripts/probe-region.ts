/**
 * Asks every chain we already collect whether it serves a given CEP.
 *
 * Opening a new town by guessing which chains have a branch there is how
 * you end up with a region holding one store and nothing to compare it
 * against. A resolved region is not enough either: a VTEX account will
 * happily hand back a region id for an address it cannot deliver to, and
 * then every search comes back empty. So this also buys a real search with
 * the token and reports how many priced products came back.
 *
 * Usage: `npx tsx scripts/probe-region.ts 12010000`
 *
 * Complexity: two requests per chain, run four at a time.
 */
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv()

import { PostalCode } from '@/domain/value-objects/PostalCode'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { VtexCatalogGateway } from '@/infrastructure/gateways/vtex/VtexCatalogGateway'
import { FetchHttpClient } from '@/infrastructure/http/FetchHttpClient'
import { StructuredLogger } from '@/infrastructure/observability/StructuredLogger'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'

/** A word every supermarket in Brazil stocks, so an empty answer means absence. */
const PROBE_TERM = 'arroz'

/**
 * Rio Branco, Acre: 3,000km from every chain here, and none of them has a
 * branch there. A chain that resolves the same region token for Acre as
 * for the town being probed is not telling us about coverage at all — it
 * is handing back a default. Without this control the first run of this
 * script cheerfully reported that Zona Sul, a Rio-only chain, serves
 * Taubate.
 */
const CONTROL_CEP = PostalCode.tryParse('69900000')!

/** Sao Paulo capital, the region we already collect, for comparison. */
const CAPITAL_CEP = PostalCode.tryParse('01310100')!

async function main(): Promise<void> {
  const [rawCep] = process.argv.slice(2)
  const postalCode = PostalCode.tryParse(rawCep)
  if (!postalCode) {
    console.error('usage: tsx scripts/probe-region.ts <cep>')
    process.exitCode = 1
    return
  }

  const env = readCollectorEnv()
  const logger = new StructuredLogger({ level: 'error' }).child({ job: 'probe' })
  const http = new FetchHttpClient(logger)
  const client = createWriteClient(env)

  const { data } = await client
    .from('stores')
    .select('slug, host, platform, sales_channel, path_prefix, storefront_host')
    .eq('platform', 'vtex-legacy')
    .order('slug')

  const chains = (data ?? []) as Array<{
    slug: string
    host: string
    sales_channel: string | null
    path_prefix: string | null
    storefront_host: string | null
  }>

  // One chain per host: hortifruti-sp and hortifruti-rj are the same account.
  const byHost = new Map<string, (typeof chains)[number]>()
  for (const chain of chains) if (!byHost.has(chain.host)) byHost.set(chain.host, chain)

  console.log(`probing ${postalCode.formatted} against ${byHost.size} VTEX chains\n`)

  const results = await Promise.all(
    [...byHost.values()].map(async (chain) => {
      const prober = new VtexCatalogGateway(
        {
          storeId: chain.slug,
          host: chain.host,
          storefrontHost: chain.storefront_host ?? undefined,
          pathPrefix: chain.path_prefix ?? undefined,
          salesChannel: chain.sales_channel ?? undefined,
        },
        http,
        logger,
      )

      const region = await prober.resolveRegion(postalCode)
      const control = await prober.resolveRegion(CONTROL_CEP)
      const capital = await prober.resolveRegion(CAPITAL_CEP)
      if (!region) {
        return {
          slug: chain.slug,
          region: null,
          control: null,
          capital: null,
          sellers: [],
          products: 0,
        }
      }

      const withRegion = new VtexCatalogGateway(
        {
          storeId: chain.slug,
          host: chain.host,
          storefrontHost: chain.storefront_host ?? undefined,
          pathPrefix: chain.path_prefix ?? undefined,
          salesChannel: chain.sales_channel ?? undefined,
          regionToken: region.regionToken,
        },
        http,
        logger,
      )

      const search = await withRegion.searchTerm(PROBE_TERM)
      const products = search.status === 'ok' ? search.products.length : -1

      return {
        slug: chain.slug,
        region: region.regionToken,
        control: control?.regionToken ?? null,
        capital: capital?.regionToken ?? null,
        sellers: region.sellerIds,
        capitalSellers: capital?.sellerIds ?? [],
        products,
      }
    }),
  )

  for (const result of results.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const regional = result.region !== null && result.region !== result.control
    const ownSellers =
      regional &&
      JSON.stringify([...(result.sellers ?? [])].sort()) !==
        JSON.stringify([...(result.capitalSellers ?? [])].sort())

    const verdict = !result.region
      ? 'no region'
      : !regional
        ? 'DEFAULT — same token as Acre, tells us nothing'
        : !ownSellers
          ? 'same sellers as the capital — served from Sao Paulo, not locally'
          : result.products > 0
            ? 'SERVES from its own branch'
            : 'own branch but nothing in stock'

    console.log(`  ${result.slug.padEnd(16)} ${verdict}`)
    console.log(`      aqui:    ${(result.sellers ?? []).join(', ') || '—'}`)
    console.log(`      capital: ${(result.capitalSellers ?? []).join(', ') || '—'}`)
  }
}

void main()

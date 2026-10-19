/**
 * Collector entry point.
 *
 * The composition root for a collection run: the only place that knows
 * Supabase, fetch and VTEX all exist at once. Everything it wires together
 * depends on ports.
 *
 * Runs in GitHub Actions rather than on Vercel. A sweep of several stores
 * takes minutes, and a Hobby serverless function is capped at sixty seconds
 * with one cron invocation a day.
 *
 * Usage: `npm run collect` for every active store, or `npm run collect mambo
 * zonasul` for named ones.
 */

import { config as loadEnv } from 'dotenv'

// Next loads .env.local on its own; a plain script does not. Without this
// the collector reads a different file from the app it feeds, which looks
// like missing credentials even though the app is configured fine.
// .env.local first: dotenv never overwrites an already-set variable, so
// this is what gives it precedence over .env and over nothing at all in CI,
// where the values arrive as real environment variables.
loadEnv({ path: '.env.local' })
loadEnv()

import { CollectStoreOffers } from '@/application/use-cases/CollectStoreOffers'
import type { Logger } from '@/application/ports/Logger'
import type { StoreCatalogGateway } from '@/application/ports/StoreCatalogGateway'
import { GpaCatalogGateway } from '@/infrastructure/gateways/gpa/GpaCatalogGateway'
import { MagentoCatalogGateway } from '@/infrastructure/gateways/magento/MagentoCatalogGateway'
import { TendaCatalogGateway } from '@/infrastructure/gateways/tenda/TendaCatalogGateway'
import { ProductMatcher } from '@/domain/services/ProductMatcher'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import { readCollectorEnv } from '@/infrastructure/config/env'
import { VtexCatalogGateway } from '@/infrastructure/gateways/vtex/VtexCatalogGateway'
import { FetchHttpClient } from '@/infrastructure/http/FetchHttpClient'
import { LoggingMetrics } from '@/infrastructure/observability/LoggingMetrics'
import { StructuredLogger } from '@/infrastructure/observability/StructuredLogger'
import { SupabaseCatalogWriter } from '@/infrastructure/persistence/supabase/SupabaseCatalogWriter'
import { createWriteClient } from '@/infrastructure/persistence/supabase/supabaseClient'
import { systemClock } from '@/infrastructure/time/SystemClock'
import { BASIC_BASKET } from './basket'

/** A store row with the platform configuration the collector needs. */
type StoreConfigRow = {
  id: string
  slug: string
  host: string
  platform: string
  sales_channel: string | null
  /** Mount point for the catalogue API when it is not at the host root. */
  path_prefix: string | null
  /** Magento store view; how a chain like Tauste prices per town. */
  store_view: string | null
  /** Per-store request gap; null takes the collector default. */
  min_interval_ms: number | null
  /** Public domain for product links, when it differs from `host`. */
  storefront_host: string | null
  region_token: string | null
  regions: { slug: string; probe_cep: string } | null
}

const MIN_INTERVAL_MS = 1_200

async function main(): Promise<void> {
  const env = readCollectorEnv()
  const logger = new StructuredLogger({ level: env.logLevel }).child({ job: 'collector' })
  const metrics = new LoggingMetrics(logger)

  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))

  const client = createWriteClient(env)
  const http = new FetchHttpClient(logger)
  const writer = new SupabaseCatalogWriter(client, logger)
  const nameParser = new ProductNameParser()
  const matcher = new ProductMatcher()

  const { data, error } = await client
    .from('stores')
    .select(
      'id, slug, host, platform, sales_channel, path_prefix, store_view, min_interval_ms, storefront_host, region_token, regions(slug, probe_cep)',
    )
    .eq('active', true)
    .order('slug')

  if (error) {
    logger.error('collector.stores_unreadable', { reason: error.message })
    process.exitCode = 1
    return
  }

  const stores = (data as unknown as StoreConfigRow[]).filter(
    (store) => requested.length === 0 || requested.includes(store.slug),
  )

  if (stores.length === 0) {
    logger.warn('collector.no_stores_selected', { requested: requested.join(',') })
    return
  }

  logger.info('collector.run_started', { stores: stores.length, terms: BASIC_BASKET.length })

  let storesWithNothing = 0

  for (const store of stores) {
    const storeLogger = logger.child({ storeId: store.id, slug: store.slug })

    const gateway = await buildGateway(store, http, storeLogger)
    if (!gateway) continue

    const report = await new CollectStoreOffers({
      gateway,
      writer,
      nameParser,
      matcher,
      logger: storeLogger,
      metrics,
      clock: systemClock,
    }).execute({ terms: BASIC_BASKET })

    if (report.offersWritten === 0) storesWithNothing += 1
  }

  logger.info('collector.run_finished', { stores: stores.length, storesWithNothing })

  // Every store producing nothing means the run is broken, not that the
  // shops are empty. One store sulking is a Tuesday.
  if (storesWithNothing === stores.length) process.exitCode = 1
}

/**
 * Picks the adapter for a store's platform.
 *
 * The only place in the collector that knows more than one platform exists.
 * Returns null for a platform with no adapter, so an unsupported row skips
 * the store rather than failing the run.
 */
async function buildGateway(
  store: StoreConfigRow,
  http: FetchHttpClient,
  logger: Logger,
): Promise<StoreCatalogGateway | null> {
  // One chain's rate limit is no reason to crawl the rest this slowly.
  const minIntervalMs = store.min_interval_ms ?? MIN_INTERVAL_MS
  if (store.platform === 'tenda-api') {
    return new TendaCatalogGateway(
      {
        storeId: store.id,
        apiHost: store.host,
        branchId: store.store_view ?? undefined,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'gpa-api') {
    const gpaStoreId = Number(store.region_token)
    if (!Number.isFinite(gpaStoreId)) {
      // Without their store id the API answers for some default area, and
      // those are not the prices anybody at this CEP would pay.
      logger.warn('collector.gpa_store_missing', { slug: store.slug })
      return null
    }

    return new GpaCatalogGateway(
      {
        storeId: store.id,
        banner: store.store_view ?? 'pa',
        gpaStoreId,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'magento-graphql') {
    return new MagentoCatalogGateway(
      {
        storeId: store.id,
        host: store.host,
        storeView: store.store_view ?? undefined,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'vtex-legacy') {
    const regionToken = store.region_token ?? (await resolveRegionToken(store, http, logger))

    if (!regionToken) {
      // Worth saying out loud: these are default-area prices, not this
      // region's, so they are weaker data than a resolved run.
      logger.warn('collector.no_region_token', { slug: store.slug })
    }

    return new VtexCatalogGateway(
      {
        storeId: store.id,
        host: store.host,
        storefrontHost: store.storefront_host ?? undefined,
        pathPrefix: store.path_prefix ?? undefined,
        salesChannel: store.sales_channel ?? undefined,
        regionToken,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  logger.warn('collector.platform_unsupported', { platform: store.platform })
  return null
}

/**
 * Asks the store which trading area its region's probe CEP falls in, so the
 * prices recorded are the ones somebody at that address would pay.
 *
 * Uses a gateway without a token to ask for one, which is why it is built
 * separately from the one that does the sweeping.
 */
async function resolveRegionToken(
  store: StoreConfigRow,
  http: FetchHttpClient,
  logger: Logger,
): Promise<string | undefined> {
  const probe = PostalCode.tryParse(store.regions?.probe_cep ?? null)
  if (!probe) {
    logger.warn('collector.no_probe_cep', { slug: store.slug })
    return undefined
  }

  const prober = new VtexCatalogGateway(
    {
      storeId: store.id,
      host: store.host,
      pathPrefix: store.path_prefix ?? undefined,
      salesChannel: store.sales_channel ?? undefined,
    },
    http,
    logger,
  )

  const resolved = await prober.resolveRegion(probe)
  if (!resolved) return undefined

  logger.info('collector.region_resolved', {
    slug: store.slug,
    sellers: resolved.sellerIds.length,
  })
  return resolved.regionToken
}

void main()

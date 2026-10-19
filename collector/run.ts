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

import 'dotenv/config'
import { CollectStoreOffers } from '@/application/use-cases/CollectStoreOffers'
import type { Logger } from '@/application/ports/Logger'
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
      'id, slug, host, platform, sales_channel, path_prefix, region_token, regions(slug, probe_cep)',
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

    if (store.platform !== 'vtex-legacy') {
      storeLogger.warn('collector.platform_unsupported', { platform: store.platform })
      continue
    }

    const regionToken =
      store.region_token ?? (await resolveRegionToken(store, http, storeLogger))

    const gateway = new VtexCatalogGateway(
      {
        storeId: store.id,
        host: store.host,
        pathPrefix: store.path_prefix ?? undefined,
        salesChannel: store.sales_channel ?? undefined,
        regionToken,
        minIntervalMs: MIN_INTERVAL_MS,
      },
      http,
      storeLogger,
    )

    if (!regionToken) {
      // Worth saying out loud: these are default-area prices, not this
      // region's, so they are weaker data than a resolved run.
      storeLogger.warn('collector.no_region_token', { slug: store.slug })
    }

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

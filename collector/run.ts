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
import type { CatalogBrowser } from '@/application/ports/CatalogBrowser'
import type { CatalogSource } from '@/application/ports/CatalogSource'
import type { StoreCatalogGateway } from '@/application/ports/StoreCatalogGateway'
import { BrowsingCatalogSource } from '@/application/sources/BrowsingCatalogSource'
import { TermCatalogSource } from '@/application/sources/TermCatalogSource'
import { MagentoCatalogBrowser } from '@/infrastructure/gateways/magento/MagentoCatalogBrowser'
import { VtexCatalogBrowser } from '@/infrastructure/gateways/vtex/VtexCatalogBrowser'
import { GpaCatalogGateway } from '@/infrastructure/gateways/gpa/GpaCatalogGateway'
import { MagentoCatalogGateway } from '@/infrastructure/gateways/magento/MagentoCatalogGateway'
import { SfccCatalogGateway } from '@/infrastructure/gateways/sfcc/SfccCatalogGateway'
import { TendaCatalogGateway } from '@/infrastructure/gateways/tenda/TendaCatalogGateway'
import { VipCommerceCatalogBrowser } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogBrowser'
import { VipCommerceCatalogGateway } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import type { VipCommerceStoreConfig } from '@/infrastructure/gateways/vipcommerce/VipCommerceCatalogGateway'
import { ProductMatcher } from '@/domain/services/ProductMatcher'
import { ProductNameParser } from '@/domain/services/ProductNameParser'
import { RequestBudget } from '@/domain/services/RequestBudget'
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
  /** Requests this store has agreed to receive per day; null is no limit. */
  daily_request_budget: number | null
  /** 'categories' walks the shop's own tree; 'terms' sweeps the basket. */
  sweep_mode: 'terms' | 'categories'
  region_token: string | null
  regions: { slug: string; probe_cep: string } | null
}

const MIN_INTERVAL_MS = 1_200

/**
 * How many stores to collect at once.
 *
 * Four rather than all of them: each one in flight holds a database
 * connection and its own page of results, and past the point where the
 * slowest store dominates the run there is nothing left to win.
 */
const STORE_CONCURRENCY = 4

async function main(): Promise<void> {
  const env = readCollectorEnv()
  const logger = new StructuredLogger({ level: env.logLevel }).child({
    job: 'collector',
  })
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
      'id, slug, host, platform, sales_channel, path_prefix, store_view, min_interval_ms, storefront_host, daily_request_budget, sweep_mode, region_token, regions(slug, probe_cep)',
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
    logger.warn('collector.no_stores_selected', {
      requested: requested.join(','),
    })
    return
  }

  logger.info('collector.run_started', {
    stores: stores.length,
    terms: BASIC_BASKET.length,
  })

  // Stores run concurrently because they are different hosts: collecting
  // Mambo and Atacadao at once adds nothing to either one's load. Within a
  // store the gateway still paces itself, so concurrency buys wall-clock
  // time without ever asking any single chain to work harder.
  //
  // Bounded rather than unbounded: every store in flight holds a Supabase
  // connection and a slice of memory, and there is no gain past the point
  // where the slowest store dominates anyway.
  const results = await inBatches(stores, STORE_CONCURRENCY, async (store) => {
    const storeLogger = logger.child({ storeId: store.id, slug: store.slug })

    // A store that capped us gets that cap enforced, counting the whole
    // day rather than this run — a second run must not win a fresh
    // allowance.
    const spentToday = await readSpentToday(client, store.id, storeLogger)
    const budget =
      store.daily_request_budget === null
        ? RequestBudget.unlimited()
        : RequestBudget.of(store.daily_request_budget, spentToday)

    if (budget.exhausted) {
      storeLogger.warn('collector.budget_already_spent', {
        slug: store.slug,
        spentToday,
        budget: store.daily_request_budget,
      })
      return { collected: false }
    }

    const source = await buildSource(store, http, storeLogger, budget)
    if (!source) return { collected: false }

    const report = await new CollectStoreOffers({
      source,
      writer,
      nameParser,
      matcher,
      logger: storeLogger,
      metrics,
      clock: systemClock,
    }).execute()

    if (store.daily_request_budget !== null) {
      await writeSpentToday(client, store.id, budget.spent, storeLogger)
      storeLogger.info('collector.budget_used', {
        slug: store.slug,
        spentThisRun: budget.spentThisRun,
        spentToday: budget.spent,
        budget: store.daily_request_budget,
      })
    }

    return { collected: report.offersWritten > 0 }
  })

  const storesWithNothing = results.filter((result) => !result.collected).length

  logger.info('collector.run_finished', {
    stores: stores.length,
    storesWithNothing,
  })

  // Every store producing nothing means the run is broken, not that the
  // shops are empty. One store sulking is a Tuesday.
  if (storesWithNothing === stores.length) process.exitCode = 1
}

/**
 * Picks how this store's catalogue gets read.
 *
 * Browsing where the row asks for it and the platform supports it;
 * otherwise the basket of search terms. A platform with a category
 * endpoint we do not trust — Tenda — simply has no browser, so the row
 * falls back rather than failing.
 */
async function buildSource(
  store: StoreConfigRow,
  http: FetchHttpClient,
  logger: Logger,
  budget: RequestBudget,
): Promise<CatalogSource | null> {
  if (store.sweep_mode === 'categories') {
    const browser = buildBrowser(store, http, logger, budget)
    if (browser) return new BrowsingCatalogSource(browser, logger)

    logger.warn('collector.no_browser_for_platform', {
      slug: store.slug,
      platform: store.platform,
    })
  }

  const gateway = await buildGateway(store, http, logger, budget)
  return gateway ? new TermCatalogSource(gateway, BASIC_BASKET) : null
}

/** Null where the platform has no category browser worth using. */
function buildBrowser(
  store: StoreConfigRow,
  http: FetchHttpClient,
  logger: Logger,
  budget: RequestBudget,
): CatalogBrowser | null {
  const minIntervalMs = store.min_interval_ms ?? MIN_INTERVAL_MS

  if (store.platform === 'magento-graphql') {
    return new MagentoCatalogBrowser(
      {
        storeId: store.id,
        host: store.host,
        storeView: store.store_view ?? undefined,
        budget,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'vtex-legacy') {
    return new VtexCatalogBrowser(
      {
        storeId: store.id,
        host: store.host,
        storefrontHost: store.storefront_host ?? undefined,
        pathPrefix: store.path_prefix ?? undefined,
        salesChannel: store.sales_channel ?? undefined,
        regionToken: store.region_token ?? undefined,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'vipcommerce') {
    const config = vipCommerceConfig(store, minIntervalMs, logger)
    return config ? new VipCommerceCatalogBrowser(config, http, logger) : null
  }

  return null
}

/**
 * The four things a VipCommerce row has to carry, or null when it does not.
 *
 * Shared by the gateway and the browser so a half-configured row fails the
 * same way whichever mode it is swept in.
 */
function vipCommerceConfig(
  store: StoreConfigRow,
  minIntervalMs: number,
  logger: Logger,
): VipCommerceStoreConfig | null {
  const organizationId = store.sales_channel
  const branchId = store.store_view
  const distributionCenterId = store.region_token
  const storefrontHost = store.storefront_host

  if (!organizationId || !branchId || !distributionCenterId || !storefrontHost) {
    // Without the distribution centre the API answers for whichever branch
    // the storefront defaults to, and those are not this region's prices.
    logger.warn('collector.vipcommerce_row_incomplete', {
      slug: store.slug,
      organizationId,
      branchId,
      distributionCenterId,
      storefrontHost,
    })
    return null
  }

  return {
    storeId: store.id,
    apiHost: store.host,
    organizationId,
    branchId,
    distributionCenterId,
    // The tenant key is the storefront's domain without its subdomain
    // prefix — the platform's own bundle derives it exactly this way,
    // stripping www./site./cdn. before asking who it is talking to.
    domainKey: storefrontHost.replace(/^(?:www|site|rc|site-cdn|cdn)\./, ''),
    storefrontHost,
    minIntervalMs,
  }
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
  budget: RequestBudget,
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
        budget,
        minIntervalMs,
      },
      http,
      logger,
    )
  }

  if (store.platform === 'vipcommerce') {
    const config = vipCommerceConfig(store, minIntervalMs, logger)
    return config ? new VipCommerceCatalogGateway(config, http, logger) : null
  }

  if (store.platform === 'sfcc') {
    if (!store.store_view || !store.region_token) {
      // The branch lives in a Demandware session keyed to that branch;
      // without it the catalogue quotes whichever one it defaults to.
      logger.warn('collector.sfcc_row_incomplete', {
        slug: store.slug,
        siteId: store.store_view,
        sfccStoreId: store.region_token,
      })
      return null
    }

    return new SfccCatalogGateway(
      {
        storeId: store.id,
        host: store.host,
        siteId: store.store_view,
        sfccStoreId: store.region_token,
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

/**
 * Runs `work` over every item, at most `size` at a time, preserving order.
 *
 * Complexity: O(n) calls in ceil(n / size) waves. Each wave is as slow as
 * its slowest member, which is the price of not pulling in a dependency for
 * a pool.
 */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let index = 0; index < items.length; index += size) {
    const wave = items.slice(index, index + size)
    results.push(...(await Promise.all(wave.map(work))))
  }

  return results
}

/** Requests already spent against this store today, or zero if unknown. */
async function readSpentToday(
  client: ReturnType<typeof createWriteClient>,
  storeId: string,
  logger: Logger,
): Promise<number> {
  const { data, error } = await client
    .from('store_request_log')
    .select('requests')
    .eq('store_id', storeId)
    .eq('day', today())
    .maybeSingle()

  if (error) {
    // Fail closed: an unreadable counter must not be read as "nothing spent
    // yet" against a store that asked us to go easy.
    logger.warn('collector.budget_unreadable', { reason: error.message })
    return Number.POSITIVE_INFINITY
  }

  return (data as { requests?: number } | null)?.requests ?? 0
}

async function writeSpentToday(
  client: ReturnType<typeof createWriteClient>,
  storeId: string,
  requests: number,
  logger: Logger,
): Promise<void> {
  const { error } = await client
    .from('store_request_log')
    .upsert({ store_id: storeId, day: today(), requests }, { onConflict: 'store_id,day' })

  if (error) logger.error('collector.budget_unwritable', { reason: error.message })
}

/** The collector's day is UTC, matching the scheduled run. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

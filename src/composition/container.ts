import type { Logger } from '@/application/ports/Logger'
import type { Metrics } from '@/application/ports/Metrics'
import type { RateLimiter } from '@/application/ports/RateLimiter'
import { GetProductDetail } from '@/application/use-cases/GetProductDetail'
import { ListRegionStores } from '@/application/use-cases/ListRegionStores'
import { ResolveShoppingContext } from '@/application/use-cases/ResolveShoppingContext'
import { SearchProducts } from '@/application/use-cases/SearchProducts'
import { OfferComparator } from '@/domain/services/OfferComparator'
import { RegionSelector } from '@/domain/services/RegionSelector'
import { TokenBucket } from '@/domain/services/TokenBucket'
import { readAppEnv } from '@/infrastructure/config/env'
import { ViaCepAddressLookup } from '@/infrastructure/gateways/viacep/ViaCepAddressLookup'
import { FetchHttpClient } from '@/infrastructure/http/FetchHttpClient'
import { LoggingMetrics } from '@/infrastructure/observability/LoggingMetrics'
import { StructuredLogger } from '@/infrastructure/observability/StructuredLogger'
import { SupabaseProductRepository } from '@/infrastructure/persistence/supabase/SupabaseProductRepository'
import { SupabaseRegionRepository } from '@/infrastructure/persistence/supabase/SupabaseRegionRepository'
import { SupabaseStoreRepository } from '@/infrastructure/persistence/supabase/SupabaseStoreRepository'
import { createReadClient } from '@/infrastructure/persistence/supabase/supabaseClient'
import { InMemoryRateLimiter } from '@/infrastructure/rate-limit/InMemoryRateLimiter'
import { SupabaseRateLimiter } from '@/infrastructure/rate-limit/SupabaseRateLimiter'
import { TieredRateLimiter } from '@/infrastructure/rate-limit/TieredRateLimiter'
import { systemClock } from '@/infrastructure/time/SystemClock'

/**
 * Allowances.
 *
 * Searching is cheap and people type, so it gets a burst. A CEP lookup calls
 * somebody else's service, so it gets much less.
 */
const SEARCH_BUCKET = new TokenBucket({ capacity: 30, refillPerSecond: 1 })
const CEP_BUCKET = new TokenBucket({ capacity: 8, refillPerSecond: 0.2 })

export type WebContainer = {
  resolveShoppingContext: ResolveShoppingContext
  searchProducts: SearchProducts
  getProductDetail: GetProductDetail
  listRegionStores: ListRegionStores
  logger: Logger
  metrics: Metrics
}

let cached: WebContainer | null = null

/**
 * The composition root for the website.
 *
 * Every concretion is chosen here and nowhere else — this is the only module
 * that imports both a use case and a Supabase client, which is what keeps the
 * dependency rule honest everywhere above it.
 *
 * Built once per process. Serverless reuses a warm instance across requests,
 * so rebuilding clients per request would waste a connection setup each time
 * and throw away the in-memory rate limiter's state, which is the one thing
 * making it useful.
 */
export function getWebContainer(): WebContainer {
  if (cached) return cached

  const env = readAppEnv()
  const logger = new StructuredLogger({ level: env.logLevel }).child({ app: 'precinho' })
  const metrics = new LoggingMetrics(logger)

  const client = createReadClient(env)
  const http = new FetchHttpClient(logger)

  const regionRepository = new SupabaseRegionRepository(client, logger)
  const storeRepository = new SupabaseStoreRepository(client, logger)
  const productRepository = new SupabaseProductRepository(client, logger)

  cached = {
    resolveShoppingContext: new ResolveShoppingContext({
      addressLookup: new ViaCepAddressLookup(http, logger),
      regionRepository,
      storeRepository,
      regionSelector: new RegionSelector(),
      rateLimiter: tiered(CEP_BUCKET, client, logger),
      logger,
      metrics,
      clock: systemClock,
    }),
    searchProducts: new SearchProducts({
      productRepository,
      storeRepository,
      rateLimiter: tiered(SEARCH_BUCKET, client, logger),
      logger,
      metrics,
      clock: systemClock,
    }),
    getProductDetail: new GetProductDetail({
      productRepository,
      storeRepository,
      comparator: new OfferComparator(),
      rateLimiter: tiered(SEARCH_BUCKET, client, logger),
      logger,
      metrics,
      clock: systemClock,
    }),
    listRegionStores: new ListRegionStores({ storeRepository, logger }),
    logger,
    metrics,
  }

  return cached
}

/** Fast local rejection in front of a limit shared across instances. */
function tiered(
  bucket: TokenBucket,
  client: ReturnType<typeof createReadClient>,
  logger: Logger,
): RateLimiter {
  return new TieredRateLimiter(
    new InMemoryRateLimiter(bucket, systemClock),
    new SupabaseRateLimiter(client, bucket, systemClock, logger),
    logger,
  )
}

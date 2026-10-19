import type { RegionSelector } from '@/domain/services/RegionSelector'
import { PostalCode } from '@/domain/value-objects/PostalCode'
import type { AddressLookup } from '../ports/AddressLookup'
import type { Clock } from '../ports/Clock'
import type { Logger } from '../ports/Logger'
import type { Metrics } from '../ports/Metrics'
import type { RateLimiter } from '../ports/RateLimiter'
import type { RegionRepository } from '../ports/RegionRepository'
import type { StoreRepository } from '../ports/StoreRepository'

export type ResolveShoppingContextInput = {
  rawPostalCode: string
  /** Identifies the caller for rate limiting; already hashed by the caller. */
  clientKey: string
}

export type ShoppingContextStore = {
  id: string
  slug: string
  name: string
  chain: string
}

/**
 * Everything the screens need to show regional prices: where the shopper is,
 * which region that resolves to, how good that match is, and which stores
 * they can pick between.
 */
export type ShoppingContext = {
  postalCode: string
  city: string
  uf: string
  neighbourhood: string | null
  region: { id: string; slug: string; name: string }
  /** 'city' when their own city is covered, 'uf' when they are seeing the state default. */
  coverage: 'city' | 'uf'
  stores: readonly ShoppingContextStore[]
}

export type ResolveShoppingContextOutput =
  | { status: 'ok'; context: ShoppingContext }
  | { status: 'invalid-postal-code' }
  | { status: 'postal-code-not-found' }
  | { status: 'no-coverage'; city: string; uf: string }
  | { status: 'rate-limited'; retryAfterSeconds: number }
  | { status: 'lookup-failed' }

export type ResolveShoppingContextDeps = {
  addressLookup: AddressLookup
  regionRepository: RegionRepository
  storeRepository: StoreRepository
  regionSelector: RegionSelector
  rateLimiter: RateLimiter
  logger: Logger
  metrics: Metrics
  clock: Clock
}

/**
 * Turns a CEP into a shopping context.
 *
 * This is the first thing that happens on the site, and it decides every
 * price shown afterwards. It returns a status rather than throwing, because
 * each outcome needs a different sentence on screen — "that CEP does not
 * exist" and "our address service is down" are not the same news, and
 * telling somebody their valid CEP is wrong is the worst of the two.
 */
export class ResolveShoppingContext {
  constructor(private readonly deps: ResolveShoppingContextDeps) {}

  /**
   * Complexity: O(r + s) over covered regions and the region's stores, both
   * short lists, plus one upstream address lookup.
   */
  async execute(input: ResolveShoppingContextInput): Promise<ResolveShoppingContextOutput> {
    const { rateLimiter, addressLookup, regionRepository, storeRepository } = this.deps
    const { regionSelector, logger, metrics, clock } = this.deps

    // Charged before parsing: a flood of malformed input is still a flood,
    // and ViaCEP is somebody else's service to protect.
    const allowance = await rateLimiter.consume(`cep:${input.clientKey}`)
    if (!allowance.allowed) {
      logger.warn('cep.rate_limited', { retryAfterSeconds: allowance.retryAfterSeconds })
      return this.finish({ status: 'rate-limited', retryAfterSeconds: allowance.retryAfterSeconds })
    }

    const postalCode = PostalCode.tryParse(input.rawPostalCode)
    if (!postalCode) {
      return this.finish({ status: 'invalid-postal-code' })
    }

    const startedAt = clock.now().getTime()
    const lookup = await addressLookup.byPostalCode(postalCode)
    metrics.timing('cep.lookup_ms', clock.now().getTime() - startedAt, { result: lookup.status })

    if (lookup.status === 'unavailable') {
      logger.error('cep.lookup_unavailable', {})
      return this.finish({ status: 'lookup-failed' })
    }
    if (lookup.status === 'not-found') {
      return this.finish({ status: 'postal-code-not-found' })
    }

    const { address } = lookup
    const regions = await regionRepository.listAll()
    const match = regionSelector.select(regions, address)

    if (!match.region || match.kind === 'none') {
      logger.info('cep.no_coverage', { city: address.city, uf: address.uf })
      return this.finish({ status: 'no-coverage', city: address.city, uf: address.uf })
    }

    const stores = await storeRepository.listByRegion(match.region.id)

    // A region can empty out after the fact: a chain gets deactivated, or
    // its robots.txt turns out to forbid us. Matching the city and then
    // returning no stores sends the shopper round a loop with nothing
    // explaining it, so an empty region is simply not coverage.
    if (stores.length === 0) {
      logger.info('cep.region_without_stores', {
        regionSlug: match.region.slug,
        city: address.city,
        uf: address.uf,
      })
      return this.finish({ status: 'no-coverage', city: address.city, uf: address.uf })
    }

    return this.finish({
      status: 'ok',
      context: {
        postalCode: postalCode.formatted,
        city: address.city,
        uf: address.uf,
        neighbourhood: address.neighbourhood,
        region: { id: match.region.id, slug: match.region.slug, name: match.region.name },
        coverage: match.kind,
        stores: [...stores]
          // Sorted by name: this list is a picker, and a stable alphabetical
          // order is easier to scan than whatever the store table returns.
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((store) => ({
            id: store.id,
            slug: store.slug,
            name: store.name,
            chain: store.chain,
          })),
      },
    })
  }

  /**
   * Single exit point, so every outcome is counted exactly once. The CEP
   * itself is never logged — it is personal data and the status is what
   * makes the log useful.
   */
  private finish(output: ResolveShoppingContextOutput): ResolveShoppingContextOutput {
    this.deps.metrics.increment('cep.resolve', 1, { status: output.status })
    return output
  }
}

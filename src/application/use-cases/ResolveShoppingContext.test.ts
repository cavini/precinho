import { describe, expect, it } from 'vitest'
import { RegionSelector } from '@/domain/services/RegionSelector'
import type { Region } from '@/domain/entities/Region'
import type { Store } from '@/domain/entities/Store'
import { FixedClock } from '../testing/FixedClock'
import {
  InMemoryRegionRepository,
  InMemoryStoreRepository,
  UnreadableRegionRepository,
  UnreadableStoreRepository,
} from '../testing/InMemoryRepositories'
import { RecordingLogger } from '../testing/RecordingLogger'
import { RecordingMetrics } from '../testing/RecordingMetrics'
import { StubAddressLookup } from '../testing/StubAddressLookup'
import { AllowingRateLimiter, DenyingRateLimiter } from '../testing/StubRateLimiter'
import { ResolveShoppingContext } from './ResolveShoppingContext'

const SAO_PAULO: Region = {
  id: 'region-sp',
  slug: 'sao-paulo-sp',
  name: 'São Paulo',
  city: 'São Paulo',
  uf: 'SP',
  isUfDefault: true,
}

const STORES: Store[] = [
  { id: 'mambo', slug: 'mambo', name: 'Mambo', chain: 'Mambo', regionId: 'region-sp' },
  {
    id: 'hortifruti',
    slug: 'hortifruti',
    name: 'Hortifruti',
    chain: 'Hortifruti',
    regionId: 'region-sp',
  },
  { id: 'zonasul', slug: 'zonasul', name: 'Zona Sul', chain: 'Zona Sul', regionId: 'region-rj' },
]

const PAULISTA = { city: 'São Paulo', uf: 'SP', neighbourhood: 'Bela Vista' }

function build(
  overrides: {
    addressLookup?: StubAddressLookup
    rateLimiter?: AllowingRateLimiter | DenyingRateLimiter
    regions?: Region[]
  } = {},
) {
  const logger = new RecordingLogger()
  const metrics = new RecordingMetrics()
  const addressLookup = overrides.addressLookup ?? new StubAddressLookup({ '01310100': PAULISTA })
  const rateLimiter = overrides.rateLimiter ?? new AllowingRateLimiter()

  const useCase = new ResolveShoppingContext({
    addressLookup,
    regionRepository: new InMemoryRegionRepository(overrides.regions ?? [SAO_PAULO]),
    storeRepository: new InMemoryStoreRepository(STORES),
    regionSelector: new RegionSelector(),
    rateLimiter,
    logger,
    metrics,
    clock: new FixedClock(new Date('2026-10-19T12:00:00Z')),
  })

  return { useCase, logger, metrics, addressLookup, rateLimiter }
}

describe('ResolveShoppingContext', () => {
  describe('a CEP we cover', () => {
    it('returns the region and the stores that serve it', async () => {
      const { useCase } = build()
      const result = await useCase.execute({ rawPostalCode: '01310-100', clientKey: 'ip-hash' })

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return

      expect(result.context.region.slug).toBe('sao-paulo-sp')
      expect(result.context.coverage).toBe('city')
      expect(result.context.stores.map((store) => store.id)).toEqual(['hortifruti', 'mambo'])
    })

    it('only offers stores in that region', async () => {
      const { useCase } = build()
      const result = await useCase.execute({ rawPostalCode: '01310-100', clientKey: 'ip-hash' })

      if (result.status !== 'ok') throw new Error('expected ok')
      expect(result.context.stores.map((store) => store.id)).not.toContain('zonasul')
    })

    it('echoes the address back so the shopper can see it resolved', async () => {
      const { useCase } = build()
      const result = await useCase.execute({ rawPostalCode: '01310100', clientKey: 'ip-hash' })

      if (result.status !== 'ok') throw new Error('expected ok')
      expect(result.context.postalCode).toBe('01310-100')
      expect(result.context.city).toBe('São Paulo')
      expect(result.context.neighbourhood).toBe('Bela Vista')
    })
  })

  describe('a CEP outside the cities we cover', () => {
    it('serves the state default and says the coverage is approximate', async () => {
      const addressLookup = new StubAddressLookup({
        '13010000': { city: 'Campinas', uf: 'SP', neighbourhood: 'Centro' },
      })
      const { useCase } = build({ addressLookup })

      const result = await useCase.execute({ rawPostalCode: '13010000', clientKey: 'ip-hash' })
      if (result.status !== 'ok') throw new Error('expected ok')

      expect(result.context.coverage).toBe('uf')
      // The real city is still reported, so the screen can be honest about it.
      expect(result.context.city).toBe('Campinas')
      expect(result.context.region.slug).toBe('sao-paulo-sp')
    })

    it('admits a covered city whose stores have all been switched off', async () => {
      // A region can empty out — a chain is deactivated, or its robots.txt
      // turns out to forbid us. Matching the city and then handing back no
      // stores sends the shopper round a loop with no explanation, so an
      // empty region is no coverage.
      const addressLookup = new StubAddressLookup({
        '17500000': { city: 'Marília', uf: 'SP', neighbourhood: 'Centro' },
      })
      const regions = [
        SAO_PAULO,
        {
          id: 'region-marilia',
          slug: 'marilia-sp',
          name: 'Marília',
          city: 'Marília',
          uf: 'SP',
          isUfDefault: false,
        },
      ]
      const { useCase } = build({ addressLookup, regions })

      const result = await useCase.execute({ rawPostalCode: '17500000', clientKey: 'ip-hash' })
      expect(result).toMatchObject({ status: 'no-coverage', city: 'Marília', uf: 'SP' })
    })

    it('admits when a state has no stores at all', async () => {
      const addressLookup = new StubAddressLookup({
        '69000000': { city: 'Manaus', uf: 'AM', neighbourhood: null },
      })
      const { useCase } = build({ addressLookup })

      const result = await useCase.execute({ rawPostalCode: '69000000', clientKey: 'ip-hash' })
      expect(result).toMatchObject({ status: 'no-coverage', city: 'Manaus', uf: 'AM' })
    })
  })

  describe('input we should not spend an upstream call on', () => {
    it('rejects a malformed CEP without asking anyone', async () => {
      const { useCase, addressLookup } = build()
      const result = await useCase.execute({ rawPostalCode: '123', clientKey: 'ip-hash' })

      expect(result.status).toBe('invalid-postal-code')
      expect(addressLookup.asked).toEqual([])
    })

    it('reports a CEP that does not exist', async () => {
      const { useCase } = build()
      const result = await useCase.execute({ rawPostalCode: '99999000', clientKey: 'ip-hash' })
      expect(result.status).toBe('postal-code-not-found')
    })

    it('separates an upstream failure from a CEP that does not exist', async () => {
      // One is the shopper's problem, the other is ours; conflating them
      // tells somebody their valid CEP is wrong.
      const addressLookup = new StubAddressLookup({ '01310100': PAULISTA })
      addressLookup.failWith = 'unavailable'
      const { useCase, logger } = build({ addressLookup })

      const result = await useCase.execute({ rawPostalCode: '01310100', clientKey: 'ip-hash' })
      expect(result.status).toBe('lookup-failed')
      expect(logger.find('cep.lookup_unavailable')).toHaveLength(1)
    })
  })

  describe('rate limiting', () => {
    it('turns away a flood before it reaches the upstream service', async () => {
      // ViaCEP is somebody else's service; hammering it gets us blocked.
      const { useCase, addressLookup } = build({ rateLimiter: new DenyingRateLimiter(30) })

      const result = await useCase.execute({ rawPostalCode: '01310100', clientKey: 'ip-hash' })
      expect(result).toMatchObject({ status: 'rate-limited', retryAfterSeconds: 30 })
      expect(addressLookup.asked).toEqual([])
    })

    it('charges the limiter against the caller, not globally', async () => {
      const { useCase, rateLimiter } = build()
      await useCase.execute({ rawPostalCode: '01310100', clientKey: 'ip-hash' })
      expect((rateLimiter as AllowingRateLimiter).keys).toEqual(['cep:ip-hash'])
    })
  })

  describe('observability', () => {
    it('counts every outcome by status', async () => {
      const { useCase, metrics } = build()
      await useCase.execute({ rawPostalCode: '01310100', clientKey: 'a' })
      await useCase.execute({ rawPostalCode: 'nope', clientKey: 'b' })

      expect(metrics.total('cep.resolve', ['status', 'ok'])).toBe(1)
      expect(metrics.total('cep.resolve', ['status', 'invalid-postal-code'])).toBe(1)
    })

    it('times the upstream lookup separately from our own work', async () => {
      const { useCase, metrics } = build()
      await useCase.execute({ rawPostalCode: '01310100', clientKey: 'a' })
      expect(metrics.timings.map((t) => t.name)).toContain('cep.lookup_ms')
    })

    it('never logs the CEP itself, which is personal', async () => {
      const { useCase, logger } = build()
      await useCase.execute({ rawPostalCode: '01310100', clientKey: 'a' })

      const serialised = JSON.stringify(logger.lines)
      expect(serialised).not.toContain('01310100')
      expect(serialised).not.toContain('01310-100')
    })
  })
})

describe('ResolveShoppingContext when a read fails', () => {
  /** The harness only varies the regions, so this one is wired by hand. */
  function withRepositories(
    regionRepository: InMemoryRegionRepository,
    storeRepository: InMemoryStoreRepository,
  ) {
    return new ResolveShoppingContext({
      addressLookup: new StubAddressLookup({ '01310100': PAULISTA }),
      regionRepository,
      storeRepository,
      regionSelector: new RegionSelector(),
      rateLimiter: new AllowingRateLimiter(),
      logger: new RecordingLogger(),
      metrics: new RecordingMetrics(),
      clock: new FixedClock(new Date('2026-10-21T12:00:00Z')),
    })
  }

  const ask = (useCase: ResolveShoppingContext) =>
    useCase.execute({ rawPostalCode: '01310-100', clientKey: 'ip-hash' })

  it('does not resolve a context when the regions cannot be read', async () => {
    const useCase = withRepositories(
      new UnreadableRegionRepository([SAO_PAULO]),
      new InMemoryStoreRepository(STORES),
    )

    expect((await ask(useCase)).status).not.toBe('ready')
  })

  it('treats an unreadable shop list the same as a region with no shops', async () => {
    // Nothing reaches this any more, since the postcode picker is gone.
    // Stated rather than left implicit, so whoever wires it up again has
    // to decide rather than inherit.
    const useCase = withRepositories(
      new InMemoryRegionRepository([SAO_PAULO]),
      new UnreadableStoreRepository(STORES),
    )

    expect((await ask(useCase)).status).not.toBe('ready')
  })
})

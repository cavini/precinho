import { describe, expect, it } from 'vitest'
import { FixedClock } from '@/application/testing/FixedClock'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { TokenBucket } from '@/domain/services/TokenBucket'
import { InMemoryRateLimiter } from './InMemoryRateLimiter'
import { TieredRateLimiter } from './TieredRateLimiter'
import { describeRateLimiterContract } from './rateLimiterContract'

const START = new Date('2026-10-19T12:00:00Z')

describeRateLimiterContract('InMemoryRateLimiter', () => {
  const clock = new FixedClock(new Date(START))
  return {
    limiter: new InMemoryRateLimiter(new TokenBucket({ capacity: 3, refillPerSecond: 1 }), clock),
    clock,
  }
})

describe('InMemoryRateLimiter bookkeeping', () => {
  function build(maxKeys?: number) {
    const clock = new FixedClock(new Date(START))
    const limiter = new InMemoryRateLimiter(
      new TokenBucket({ capacity: 3, refillPerSecond: 1 }),
      clock,
      { maxKeys },
    )
    return { limiter, clock }
  }

  it('bounds how many callers it remembers', async () => {
    // An unbounded map keyed by caller is its own denial of service.
    const { limiter } = build(3)

    for (let i = 0; i < 10; i += 1) await limiter.consume(`caller-${i}`)
    expect(limiter.trackedKeys).toBeLessThanOrEqual(3)
  })

  it('evicts the least recently seen caller', async () => {
    const { limiter } = build(2)

    await limiter.consume('a')
    await limiter.consume('b')
    // Touching 'a' again makes 'b' the oldest.
    await limiter.consume('a')
    await limiter.consume('c')

    // 'a' was kept, so both of its spends are remembered. Asserted first,
    // because reading 'b' back re-inserts it and evicts 'a' in turn.
    expect((await limiter.consume('a')).remaining).toBe(0)
    // 'b' was evicted, so it starts full again.
    expect((await limiter.consume('b')).remaining).toBe(2)
  })
})

describe('TieredRateLimiter', () => {
  function build(options: { durable?: 'allow' | 'deny' | 'throw' } = {}) {
    const clock = new FixedClock(new Date(START))
    const local = new InMemoryRateLimiter(
      new TokenBucket({ capacity: 3, refillPerSecond: 1 }),
      clock,
    )
    const calls: string[] = []
    const durable = {
      consume: async (key: string) => {
        calls.push(key)
        if (options.durable === 'throw') throw new Error('table unreachable')
        if (options.durable === 'deny') {
          return { allowed: false, remaining: 0, retryAfterSeconds: 7 }
        }
        return { allowed: true, remaining: 42, retryAfterSeconds: 0 }
      },
    }
    const logger = new RecordingLogger()
    return { limiter: new TieredRateLimiter(local, durable, logger), calls, logger, clock }
  }

  it('answers from the shared limiter when the local one allows', async () => {
    const { limiter, calls } = build()
    const decision = await limiter.consume('caller')

    expect(decision.remaining).toBe(42)
    expect(calls).toEqual(['caller'])
  })

  it('lets the shared limiter deny what the local one would allow', async () => {
    // The local limiter only sees this instance's share of the traffic.
    const { limiter } = build({ durable: 'deny' })
    expect(await limiter.consume('caller')).toMatchObject({
      allowed: false,
      retryAfterSeconds: 7,
    })
  })

  it('stops at the local limiter during an actual flood', async () => {
    // No point spending a round trip on a request already over the line.
    const { limiter, calls } = build()
    for (let i = 0; i < 3; i += 1) await limiter.consume('caller')
    calls.length = 0

    const decision = await limiter.consume('caller')
    expect(decision.allowed).toBe(false)
    expect(calls).toEqual([])
  })

  it('fails open when the shared store is unreachable', async () => {
    // Taking the site down because a rate-limit table is unavailable trades
    // a small problem for a total one. The local limiter has already had its say.
    const { limiter, logger } = build({ durable: 'throw' })

    expect((await limiter.consume('caller')).allowed).toBe(true)
    expect(logger.find('rate_limit.durable_failed')).toHaveLength(1)
  })
})

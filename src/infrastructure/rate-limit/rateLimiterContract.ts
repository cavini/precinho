import { describe, expect, it } from 'vitest'
import type { RateLimiter } from '@/application/ports/RateLimiter'
import type { FixedClock } from '@/application/testing/FixedClock'

export type RateLimiterUnderTest = {
  limiter: RateLimiter
  clock: FixedClock
}

/**
 * The behaviour every RateLimiter implementation must have.
 *
 * Written once and run against each adapter, because the in-memory and
 * database-backed limiters are the same promise kept two ways. A contract
 * suite is the only thing that stops them drifting — the alternative is
 * discovering in production that one of them counts differently.
 *
 * Implementations are built with capacity 3 and refill 1/second.
 */
export function describeRateLimiterContract(
  name: string,
  create: () => RateLimiterUnderTest | Promise<RateLimiterUnderTest>,
): void {
  describe(`${name} satisfies the RateLimiter contract`, () => {
    it('allows a caller up to capacity', async () => {
      const { limiter } = await create()

      for (let i = 0; i < 3; i += 1) {
        expect((await limiter.consume('caller')).allowed).toBe(true)
      }
    })

    it('denies the request past capacity', async () => {
      const { limiter } = await create()
      for (let i = 0; i < 3; i += 1) await limiter.consume('caller')

      const decision = await limiter.consume('caller')
      expect(decision.allowed).toBe(false)
      expect(decision.remaining).toBe(0)
      expect(decision.retryAfterSeconds).toBeGreaterThan(0)
    })

    it('counts down the remaining allowance', async () => {
      const { limiter } = await create()
      expect((await limiter.consume('caller')).remaining).toBe(2)
      expect((await limiter.consume('caller')).remaining).toBe(1)
      expect((await limiter.consume('caller')).remaining).toBe(0)
    })

    it('keeps callers separate', async () => {
      // One shopper hitting the limit must not lock out everybody else.
      const { limiter } = await create()
      for (let i = 0; i < 3; i += 1) await limiter.consume('noisy')

      expect((await limiter.consume('noisy')).allowed).toBe(false)
      expect((await limiter.consume('quiet')).allowed).toBe(true)
    })

    it('refills over time', async () => {
      const { limiter, clock } = await create()
      for (let i = 0; i < 3; i += 1) await limiter.consume('caller')
      expect((await limiter.consume('caller')).allowed).toBe(false)

      clock.advanceSeconds(2)
      expect((await limiter.consume('caller')).allowed).toBe(true)
      expect((await limiter.consume('caller')).allowed).toBe(true)
      expect((await limiter.consume('caller')).allowed).toBe(false)
    })

    it('does not refill past capacity however long it waits', async () => {
      const { limiter, clock } = await create()
      await limiter.consume('caller')
      clock.advanceSeconds(3_600)

      for (let i = 0; i < 3; i += 1) {
        expect((await limiter.consume('caller')).allowed).toBe(true)
      }
      expect((await limiter.consume('caller')).allowed).toBe(false)
    })

    it('treats a long-idle caller the same as a new one', async () => {
      const { limiter, clock } = await create()
      for (let i = 0; i < 3; i += 1) await limiter.consume('caller')

      clock.advanceSeconds(86_400)
      expect((await limiter.consume('caller')).allowed).toBe(true)
    })
  })
}

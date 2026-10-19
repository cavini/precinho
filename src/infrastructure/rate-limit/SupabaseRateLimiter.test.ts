import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { FixedClock } from '@/application/testing/FixedClock'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { TokenBucket } from '@/domain/services/TokenBucket'
import { SupabaseRateLimiter } from './SupabaseRateLimiter'
import { describeRateLimiterContract } from './rateLimiterContract'

type Row = { tokens: number; updated_at: string }

/**
 * Implements the two rate-limit functions from 0002_search_functions.sql,
 * compare-and-set and all.
 *
 * This tests my adapter — the retry loop, the state mapping, the decision it
 * returns — against the semantics the SQL promises, without needing a
 * database. Whether Postgres honours those semantics is the migration's job,
 * and the contract suite runs against a real database in CI when one is
 * configured.
 */
class FakeRateLimitStore {
  private readonly rows = new Map<string, Row>()
  /** How many of the next writes lose their compare-and-set, as a rival would. */
  stealBeforeNextWrite = 0
  /** What the rival leaves behind. Tests say this explicitly, because
   *  whether the retry is then allowed depends entirely on it. */
  stealRow: Row = { tokens: 2, updated_at: new Date('2026-10-19T12:00:00Z').toISOString() }

  readonly client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'read_rate_limit') {
        const row = this.rows.get(args.p_key as string)
        return { data: row ? [row] : [], error: null }
      }

      if (fn === 'write_rate_limit') {
        const key = args.p_key as string
        const expected = args.p_expected_updated_at as string | null

        if (this.stealBeforeNextWrite > 0) {
          this.stealBeforeNextWrite -= 1
          // Somebody else wrote first, so the row no longer matches.
          this.rows.set(key, { ...this.stealRow })
          return { data: false, error: null }
        }

        const current = this.rows.get(key)
        const matches = expected === null ? current === undefined : current?.updated_at === expected
        if (!matches) return { data: false, error: null }

        this.rows.set(key, {
          tokens: args.p_tokens as number,
          updated_at: args.p_updated_at as string,
        })
        return { data: true, error: null }
      }

      throw new Error(`unexpected rpc ${fn}`)
    },
  } as unknown as SupabaseClient
}

const START = new Date('2026-10-19T12:00:00Z')

describeRateLimiterContract('SupabaseRateLimiter', () => {
  const clock = new FixedClock(new Date(START))
  const store = new FakeRateLimitStore()

  return {
    limiter: new SupabaseRateLimiter(
      store.client,
      new TokenBucket({ capacity: 3, refillPerSecond: 1 }),
      clock,
      new RecordingLogger(),
    ),
    clock,
  }
})

describe('SupabaseRateLimiter under contention', () => {
  function build() {
    const clock = new FixedClock(new Date(START))
    const store = new FakeRateLimitStore()
    const logger = new RecordingLogger()
    const limiter = new SupabaseRateLimiter(
      store.client,
      new TokenBucket({ capacity: 3, refillPerSecond: 1 }),
      clock,
      logger,
    )
    return { limiter, store, logger }
  }

  it('retries a lost compare-and-set and answers from the state that won', async () => {
    const { limiter, store, logger } = build()
    store.stealBeforeNextWrite = 1
    // The rival spent one of three tokens, so this request should get one too.
    store.stealRow = { tokens: 2, updated_at: START.toISOString() }

    const decision = await limiter.consume('caller')
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(1)
    expect(logger.find('rate_limit.cas_lost')).toHaveLength(1)
  })

  it('respects what the rival left, rather than its own stale read', async () => {
    const { limiter, store } = build()
    store.stealBeforeNextWrite = 1
    // The rival drained the bucket between our read and our write.
    store.stealRow = { tokens: 0, updated_at: START.toISOString() }

    expect((await limiter.consume('caller')).allowed).toBe(false)
  })

  it('denies once it has lost too many times', async () => {
    // A key contended this hard is the flood this exists to stop, so failing
    // closed is the right way round. The tier above still fails open if the
    // table itself is unreachable.
    const { limiter, store, logger } = build()
    store.stealBeforeNextWrite = 5

    const decision = await limiter.consume('caller')
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBeGreaterThan(0)
    expect(logger.find('rate_limit.cas_exhausted')).toHaveLength(1)
  })

  it('lets a database error through for the tier above to handle', async () => {
    const failing = {
      rpc: async () => ({ data: null, error: { message: 'relation does not exist' } }),
    } as unknown as SupabaseClient

    const limiter = new SupabaseRateLimiter(
      failing,
      new TokenBucket({ capacity: 3, refillPerSecond: 1 }),
      new FixedClock(new Date(START)),
      new RecordingLogger(),
    )

    await expect(limiter.consume('caller')).rejects.toThrow(/read_rate_limit failed/)
  })
})

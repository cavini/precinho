import { describe, expect, it } from 'vitest'
import { TokenBucket } from './TokenBucket'

// 10 requests refilling at 1/s — ample for someone typing, nowhere near
// enough for a script.
const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 })
const T0 = 1_700_000_000_000

/** Spends `count` tokens starting from a fresh bucket, all at T0. */
function drain(count: number) {
  let state = bucket.consume(undefined, T0).state
  for (let i = 1; i < count; i += 1) state = bucket.consume(state, T0).state
  return state
}

describe('TokenBucket', () => {
  it('starts full, so a first-time visitor is never throttled', () => {
    const { decision } = bucket.consume(undefined, T0)
    expect(decision.allowed).toBe(true)
    expect(decision.remaining).toBe(9)
  })

  it('spends one token per request', () => {
    expect(bucket.consume(drain(6), T0).decision.remaining).toBe(3)
  })

  it('denies the request that finds the bucket empty', () => {
    const { decision } = bucket.consume(drain(10), T0)
    expect(decision.allowed).toBe(false)
    expect(decision.remaining).toBe(0)
  })

  it('tells a denied caller when to come back', () => {
    expect(bucket.consume(drain(10), T0).decision.retryAfterSeconds).toBe(1)
  })

  it('does not spend a token on a denied request', () => {
    const empty = drain(10)
    const denied = bucket.consume(empty, T0)
    expect(denied.state.tokens).toBe(0)
  })

  it('refills over time', () => {
    const empty = drain(10)
    expect(bucket.consume(empty, T0).decision.allowed).toBe(false)

    // Three seconds on, three tokens are back; this request spends one.
    const later = bucket.consume(empty, T0 + 3_000)
    expect(later.decision.allowed).toBe(true)
    expect(later.decision.remaining).toBe(2)
  })

  it('never refills past capacity', () => {
    const state = bucket.consume(undefined, T0).state
    expect(bucket.consume(state, T0 + 3_600_000).decision.remaining).toBe(9)
  })

  it('ignores a clock that runs backwards instead of granting free tokens', () => {
    // Serverless instances drift; skew must not reset somebody's limit.
    expect(bucket.consume(drain(10), T0 - 60_000).decision.allowed).toBe(false)
  })

  it('treats corrupt stored state as a fresh bucket', () => {
    const corrupt = { tokens: Number.NaN, updatedAtMs: Number.NaN }
    expect(bucket.consume(corrupt, T0).decision.allowed).toBe(true)
  })

  it('refuses a nonsensical configuration at construction', () => {
    expect(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 })).toThrow(/capacity/i)
    expect(() => new TokenBucket({ capacity: 10, refillPerSecond: 0 })).toThrow(/refill/i)
  })
})

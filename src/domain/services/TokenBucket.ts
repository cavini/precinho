import { InvalidRateLimitConfigError } from '../errors/DomainError'

/** What a caller has left. Small and serialisable so any store can hold it. */
export type BucketState = {
  tokens: number
  updatedAtMs: number
}

export type RateLimitDecision = {
  allowed: boolean
  /** Whole tokens left after this request. */
  remaining: number
  /** Zero when allowed; otherwise how long until one token is back. */
  retryAfterSeconds: number
}

export type TokenBucketConfig = {
  /** Burst size — how many requests back to back are fine. */
  capacity: number
  /** Sustained rate, in tokens per second. */
  refillPerSecond: number
}

/**
 * Token bucket rate limiting, as a pure decision over stored state.
 *
 * A bucket beats a fixed window here because shoppers type in bursts: a
 * window either rejects normal typing or lets twice the limit through across
 * a window boundary. A bucket absorbs the burst and still caps the sustained
 * rate.
 *
 * Keeping it pure and passing the clock in is what makes every edge case
 * above testable without waiting, and lets the same logic sit behind an
 * in-memory store or a Postgres row — the adapter only has to load and save
 * `BucketState`.
 *
 * Refill is computed lazily from the elapsed time, so there is no timer and
 * no per-caller bookkeeping: O(1) time and O(1) state per caller.
 */
export class TokenBucket {
  constructor(private readonly config: TokenBucketConfig) {
    if (!Number.isFinite(config.capacity) || config.capacity <= 0) {
      throw new InvalidRateLimitConfigError('Bucket capacity must be positive')
    }
    if (!Number.isFinite(config.refillPerSecond) || config.refillPerSecond <= 0) {
      throw new InvalidRateLimitConfigError('Bucket refill rate must be positive')
    }
  }

  /**
   * Charges one token for a request and reports the outcome.
   *
   * Pass `undefined` for a caller that has not been seen; corrupt state is
   * treated the same way, since a readable-but-nonsense row should fail open
   * for a real shopper rather than lock them out.
   *
   * Complexity: O(1).
   */
  consume(
    state: BucketState | undefined,
    nowMs: number,
  ): { decision: RateLimitDecision; state: BucketState } {
    const { capacity, refillPerSecond } = this.config
    const previous = normalizeState(state, capacity, nowMs)

    // Clamped at zero so a clock running backwards between serverless
    // instances cannot hand out free tokens.
    const elapsedMs = Math.max(0, nowMs - previous.updatedAtMs)
    const available = Math.min(capacity, previous.tokens + (elapsedMs / 1000) * refillPerSecond)

    const allowed = available >= 1
    const tokens = allowed ? available - 1 : available

    return {
      decision: {
        allowed,
        remaining: Math.floor(tokens),
        retryAfterSeconds: allowed ? 0 : Math.ceil((1 - available) / refillPerSecond),
      },
      // Never moves backwards, for the same clock-skew reason.
      state: { tokens, updatedAtMs: Math.max(nowMs, previous.updatedAtMs) },
    }
  }
}

function normalizeState(
  state: BucketState | undefined,
  capacity: number,
  nowMs: number,
): BucketState {
  if (!state || !Number.isFinite(state.tokens) || !Number.isFinite(state.updatedAtMs)) {
    return { tokens: capacity, updatedAtMs: nowMs }
  }
  return state
}

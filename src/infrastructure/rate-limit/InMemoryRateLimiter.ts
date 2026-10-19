import type { Clock } from '@/application/ports/Clock'
import type { RateLimiter } from '@/application/ports/RateLimiter'
import type { BucketState, RateLimitDecision, TokenBucket } from '@/domain/services/TokenBucket'

export type InMemoryRateLimiterOptions = {
  /**
   * How many callers to remember. An unbounded map keyed by caller is itself
   * a way to exhaust memory, so the oldest entries are dropped once it is
   * full — a caller whose bucket was evicted starts full, which is the same
   * answer they would get after waiting for it to refill anyway.
   */
  maxKeys?: number
}

const DEFAULT_MAX_KEYS = 10_000

/**
 * Per-instance rate limiting.
 *
 * Fast, and useless on its own in a serverless deployment: each instance
 * sees only its own share of traffic, so the real ceiling is the limit times
 * the number of instances. Its job is to reject a flood that lands on one
 * instance without spending a database round trip on it — see
 * TieredRateLimiter.
 *
 * Insertion order is the eviction order, which Map gives us for free.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>()
  private readonly maxKeys: number

  constructor(
    private readonly bucket: TokenBucket,
    private readonly clock: Clock,
    options: InMemoryRateLimiterOptions = {},
  ) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  }

  /** Complexity: O(1) amortised. */
  async consume(key: string): Promise<RateLimitDecision> {
    const { decision, state } = this.bucket.consume(this.buckets.get(key), this.clock.now().getTime())

    // Re-inserting moves the key to the end, so the least recently seen
    // caller is the one evicted.
    this.buckets.delete(key)
    this.buckets.set(key, state)

    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next()
      if (!oldest.done) this.buckets.delete(oldest.value)
    }

    return decision
  }

  /** Exposed for assertions and for a health endpoint. */
  get trackedKeys(): number {
    return this.buckets.size
  }
}

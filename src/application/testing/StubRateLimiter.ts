import type { RateLimitDecision } from '@/domain/services/TokenBucket'
import type { RateLimiter } from '../ports/RateLimiter'

/** Allows everything, and records what it was asked about. */
export class AllowingRateLimiter implements RateLimiter {
  readonly keys: string[] = []

  async consume(key: string): Promise<RateLimitDecision> {
    this.keys.push(key)
    return { allowed: true, remaining: 9, retryAfterSeconds: 0 }
  }
}

/** Denies everything, for asserting the rejection path. */
export class DenyingRateLimiter implements RateLimiter {
  constructor(private readonly retryAfterSeconds = 30) {}

  async consume(): Promise<RateLimitDecision> {
    return { allowed: false, remaining: 0, retryAfterSeconds: this.retryAfterSeconds }
  }
}

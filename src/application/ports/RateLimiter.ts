import type { RateLimitDecision } from '@/domain/services/TokenBucket'

/**
 * Charges one request against a caller's allowance.
 *
 * The key is supplied by the caller rather than read from a request here, so
 * this stays testable and so the presentation layer decides what identifies a
 * caller — and can hash it rather than storing a raw address.
 */
export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>
}

/** Used where a limiter is structurally required but the route is not public. */
export const unlimited: RateLimiter = {
  consume: async () => ({ allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 }),
}

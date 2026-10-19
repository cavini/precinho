import type { RateLimiter } from '@/application/ports/RateLimiter'

/**
 * Null-object limiter, for call sites where a limiter is structurally
 * required but the caller is not the public internet — the collector running
 * from CI, for instance.
 */
export const noRateLimit: RateLimiter = {
  consume: async () => ({
    allowed: true,
    remaining: Number.MAX_SAFE_INTEGER,
    retryAfterSeconds: 0,
  }),
}

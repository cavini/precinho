import type { Logger } from '@/application/ports/Logger'
import type { RateLimiter } from '@/application/ports/RateLimiter'
import type { RateLimitDecision } from '@/domain/services/TokenBucket'

/**
 * A fast local limiter in front of a durable shared one.
 *
 * Neither is sufficient alone. In-memory counters are per-instance, so on
 * serverless the effective limit is the limit times however many instances
 * are warm. A shared store is correct but costs a round trip on every
 * request, including the ones already obviously over the line.
 *
 * So: ask the local one first and stop there if it already says no, which is
 * the case during an actual flood. Only a request the local limiter would
 * allow is worth asking the shared one about.
 *
 * If the durable limiter fails, this fails *open* — the local limiter has
 * already had its say, and taking the site down because a rate-limit table
 * is unreachable trades a small problem for a total one.
 */
export class TieredRateLimiter implements RateLimiter {
  constructor(
    private readonly local: RateLimiter,
    private readonly durable: RateLimiter,
    private readonly logger: Logger,
  ) {}

  /** Complexity: O(1) local, plus at most one durable round trip. */
  async consume(key: string): Promise<RateLimitDecision> {
    const localDecision = await this.local.consume(key)
    if (!localDecision.allowed) return localDecision

    try {
      return await this.durable.consume(key)
    } catch (error) {
      this.logger.error('rate_limit.durable_failed', {
        reason: error instanceof Error ? error.message : String(error),
      })
      return localDecision
    }
  }
}

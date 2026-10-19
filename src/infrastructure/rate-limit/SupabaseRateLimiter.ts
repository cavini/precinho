import type { SupabaseClient } from '@supabase/supabase-js'
import type { Clock } from '@/application/ports/Clock'
import type { Logger } from '@/application/ports/Logger'
import type { RateLimiter } from '@/application/ports/RateLimiter'
import type { BucketState, RateLimitDecision, TokenBucket } from '@/domain/services/TokenBucket'

/** How many times to retry a lost compare-and-set before giving up. */
const MAX_ATTEMPTS = 3

/**
 * Rate limiting shared across every serverless instance.
 *
 * The bucket arithmetic is the domain's; this only loads and stores state.
 * Keeping it that way means there is one implementation of the algorithm
 * rather than one in TypeScript and another in plpgsql quietly disagreeing —
 * and it is why this adapter can be held to the same contract suite as the
 * in-memory one.
 *
 * The write is a compare-and-set on the row's timestamp. If another instance
 * got there first, retry with the state it wrote. After a few attempts, deny:
 * a key contended enough to lose three times in a row is the flood this
 * exists to stop, so failing closed is the right way round here. (The tier
 * above still fails open if the table itself is unreachable.)
 */
export class SupabaseRateLimiter implements RateLimiter {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: TokenBucket,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Complexity: 2 to 2*MAX_ATTEMPTS round trips; O(1) work per attempt. */
  async consume(key: string): Promise<RateLimitDecision> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const stored = await this.read(key)
      const { decision, state } = this.bucket.consume(stored?.state, this.clock.now().getTime())

      const written = await this.write(key, state, stored?.updatedAt ?? null)
      if (written) return decision

      this.logger.debug('rate_limit.cas_lost', { attempt })
    }

    this.logger.warn('rate_limit.cas_exhausted', { attempts: MAX_ATTEMPTS })
    return { allowed: false, remaining: 0, retryAfterSeconds: 1 }
  }

  private async read(
    key: string,
  ): Promise<{ state: BucketState; updatedAt: string } | null> {
    const { data, error } = await this.client.rpc('read_rate_limit', { p_key: key })
    if (error) throw new Error(`read_rate_limit failed: ${error.message}`)

    const [row] = (data ?? []) as Array<{ tokens: number; updated_at: string }>
    if (!row) return null

    return {
      state: { tokens: row.tokens, updatedAtMs: new Date(row.updated_at).getTime() },
      updatedAt: row.updated_at,
    }
  }

  private async write(
    key: string,
    state: BucketState,
    expectedUpdatedAt: string | null,
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc('write_rate_limit', {
      p_key: key,
      p_tokens: state.tokens,
      p_updated_at: new Date(state.updatedAtMs).toISOString(),
      p_expected_updated_at: expectedUpdatedAt,
    })

    if (error) throw new Error(`write_rate_limit failed: ${error.message}`)
    return data === true
  }
}

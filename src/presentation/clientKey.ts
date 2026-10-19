import { createHash } from 'node:crypto'

/**
 * Who is making this request, for rate limiting only.
 *
 * The address is hashed, never stored or logged raw: the limiter needs to
 * tell callers apart, which a hash does, and does not need to know who they
 * are. A per-deployment salt keeps the hashes from being reversible by
 * guessing addresses.
 *
 * Falls back to a shared bucket when no address is available. That is
 * deliberately conservative — unidentifiable traffic sharing one allowance is
 * safer than unidentifiable traffic having none.
 */
const SHARED_FALLBACK = 'unknown'

export function clientKeyFromHeaders(headers: Headers, salt = process.env.RATE_LIMIT_SALT ?? ''): string {
  const address = firstAddress(headers)
  if (!address) return SHARED_FALLBACK

  return createHash('sha256').update(`${salt}:${address}`).digest('base64url').slice(0, 22)
}

/**
 * x-forwarded-for is a comma-separated chain; the first entry is the client
 * as the edge saw it. Later entries are proxies and are attacker-controlled.
 *
 * Complexity: O(n) in the header length.
 */
function firstAddress(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  return headers.get('x-real-ip')?.trim() || null
}

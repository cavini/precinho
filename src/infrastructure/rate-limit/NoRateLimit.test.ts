import { describe, expect, it } from 'vitest'
import { noRateLimit } from './NoRateLimit'

describe('noRateLimit', () => {
  it('allows every request, for callers that are not the public internet', async () => {
    const decision = await noRateLimit.consume('collector')
    expect(decision.allowed).toBe(true)
    expect(decision.retryAfterSeconds).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { clientKeyFromHeaders } from './clientKey'

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

describe('clientKeyFromHeaders', () => {
  it('tells two callers apart', () => {
    const a = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    const b = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.2' }), 'salt')
    expect(a).not.toBe(b)
  })

  it('gives the same caller the same key', () => {
    const first = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    const second = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    expect(first).toBe(second)
  })

  it('never contains the address', () => {
    // The limiter needs to tell callers apart, not know who they are.
    const key = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    expect(key).not.toContain('203.0.113.1')
    expect(key).not.toContain('203')
  })

  it('is not reversible by guessing addresses without the salt', () => {
    const salted = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'secret')
    const unsalted = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), '')
    expect(salted).not.toBe(unsalted)
  })

  it('takes the first entry of the forwarded chain', () => {
    // Later entries are proxies, and are attacker-controlled.
    const direct = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    const chained = clientKeyFromHeaders(
      headers({ 'x-forwarded-for': '203.0.113.1, 70.41.3.18, 150.172.238.178' }),
      'salt',
    )
    expect(chained).toBe(direct)
  })

  it('falls back to x-real-ip', () => {
    const key = clientKeyFromHeaders(headers({ 'x-real-ip': '203.0.113.9' }), 'salt')
    expect(key).not.toBe(clientKeyFromHeaders(headers({}), 'salt'))
    expect(key).toBeTruthy()
  })

  it('puts unidentifiable traffic in one shared bucket', () => {
    // Safer than giving it no limit at all.
    const a = clientKeyFromHeaders(headers({}), 'salt')
    const b = clientKeyFromHeaders(headers({ 'x-forwarded-for': '   ' }), 'salt')
    expect(a).toBe(b)
  })

  it('produces a key short enough to be a database key', () => {
    const key = clientKeyFromHeaders(headers({ 'x-forwarded-for': '203.0.113.1' }), 'salt')
    expect(key.length).toBeLessThanOrEqual(22)
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

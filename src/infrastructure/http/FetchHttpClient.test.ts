import { describe, expect, it, vi } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { FetchHttpClient } from './FetchHttpClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function build(fetchImpl: typeof fetch, options: { maxRetries?: number } = {}) {
  const logger = new RecordingLogger()
  const slept: number[] = []
  const client = new FetchHttpClient(logger, {
    fetchImpl,
    retryBaseMs: 100,
    sleep: async (ms) => {
      slept.push(ms)
    },
    ...options,
  })
  return { client, logger, slept }
}

describe('FetchHttpClient', () => {
  it('returns a parsed body', async () => {
    const { client } = build(async () => jsonResponse({ hello: 'world' }))
    const result = await client.getJson('https://example.com/a')

    expect(result).toMatchObject({ status: 'ok', statusCode: 200, body: { hello: 'world' } })
  })

  it('exposes response headers, lower-cased', async () => {
    // VTEX reports a category's exact size in a `resources: 0-0/1856`
    // header, which is what lets a catalogue sweep be planned without
    // downloading a single product.
    const { client } = build(
      async () =>
        new Response(JSON.stringify([]), {
          status: 206,
          headers: { 'Content-Type': 'application/json', Resources: '0-0/1856' },
        }),
    )

    const result = await client.getJson('https://example.com/a')
    if (result.status !== 'ok') throw new Error(result.status)
    expect(result.headers.resources).toBe('0-0/1856')
  })

  it('treats 206 as success, which is what the VTEX catalogue answers', async () => {
    const { client } = build(async () => jsonResponse([{ productId: '1' }], 206))
    const result = await client.getJson('https://example.com/a')

    expect(result.status).toBe('ok')
  })

  it('passes headers through', async () => {
    const seen: Array<Record<string, string> | undefined> = []
    const { client } = build(async (_url, init) => {
      seen.push(init?.headers as Record<string, string>)
      return jsonResponse({})
    })

    await client.getJson('https://example.com/a', { headers: { 'User-Agent': 'precinho' } })
    expect(seen[0]?.['User-Agent']).toBe('precinho')
  })

  it('reports a body that is not JSON', async () => {
    const { client } = build(async () => new Response('<html>nope</html>', { status: 200 }))
    expect(await client.getJson('https://example.com/a')).toEqual({ status: 'invalid-json' })
  })

  describe('retrying', () => {
    it('retries a 5xx and succeeds', async () => {
      let calls = 0
      const { client, slept } = build(async () => {
        calls += 1
        return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: true })
      })

      const result = await client.getJson('https://example.com/a')
      expect(result.status).toBe('ok')
      expect(calls).toBe(2)
      expect(slept).toEqual([100])
    })

    it('backs off exponentially rather than hammering', async () => {
      const { client, slept } = build(async () => jsonResponse({}, 500))
      await client.getJson('https://example.com/a')
      expect(slept).toEqual([100, 200])
    })

    it('does not retry a 4xx, which is an answer', async () => {
      // Asking again spends somebody else's capacity to get the same no.
      let calls = 0
      const { client } = build(async () => {
        calls += 1
        return jsonResponse({}, 404)
      })

      expect(await client.getJson('https://example.com/a')).toEqual({
        status: 'http-error',
        statusCode: 404,
      })
      expect(calls).toBe(1)
    })

    it('retries a connection failure', async () => {
      let calls = 0
      const { client } = build(async () => {
        calls += 1
        if (calls === 1) throw new TypeError('fetch failed')
        return jsonResponse({ ok: true })
      })

      expect((await client.getJson('https://example.com/a')).status).toBe('ok')
      expect(calls).toBe(2)
    })

    it('gives up loudly after the last attempt', async () => {
      const { client, logger } = build(async () => {
        throw new TypeError('ECONNRESET')
      })

      const result = await client.getJson('https://example.com/a')
      expect(result).toEqual({ status: 'network-error', reason: 'ECONNRESET' })
      expect(logger.find('http.gave_up')[0].fields.attempts).toBe(3)
    })

    it('can be told not to retry at all', async () => {
      let calls = 0
      const { client } = build(
        async () => {
          calls += 1
          return jsonResponse({}, 503)
        },
        { maxRetries: 0 },
      )

      await client.getJson('https://example.com/a')
      expect(calls).toBe(1)
    })
  })

  describe('timeouts', () => {
    it('aborts a request that never answers', async () => {
      vi.useFakeTimers()
      try {
        const { client } = build(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              })
            }),
          { maxRetries: 0 },
        )

        const pending = client.getJson('https://example.com/slow', { timeoutMs: 5_000 })
        await vi.advanceTimersByTimeAsync(5_000)

        expect(await pending).toEqual({ status: 'timeout' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('clears the timer on a response, so a process can exit', async () => {
      // A dangling timer keeps the collector alive after its work is done.
      vi.useFakeTimers()
      try {
        const { client } = build(async () => jsonResponse({}))
        await client.getJson('https://example.com/a', { timeoutMs: 5_000 })
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})

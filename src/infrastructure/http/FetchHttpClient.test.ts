import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingLogger } from '@/application/testing/RecordingLogger'
import { FetchHttpClient } from './FetchHttpClient'

function answering(status: number, body: string) {
  const fetchMock = vi.fn(async () => new Response(body, { status }))
  vi.stubGlobal('fetch', fetchMock)
  return new FetchHttpClient(new RecordingLogger())
}

afterEach(() => vi.unstubAllGlobals())

describe('FetchHttpClient on a failed response', () => {
  it('carries back the reason the server gave', async () => {
    // "http-error 400" and nothing else cost two diagnoses an hour each:
    // the API was saying the key had no workspace, and then that the
    // balance was empty, and neither message reached the log.
    const client = answering(
      400,
      '{"type":"error","error":{"message":"This API key is not scoped to a workspace"}}',
    )

    const response = await client.getJson('https://api.example.test/thing')

    expect(response).toMatchObject({ status: 'http-error', statusCode: 400 })
    if (response.status !== 'http-error') throw new Error('expected a failure')
    expect(response.body).toContain('not scoped to a workspace')
  })

  it('truncates a page of HTML rather than putting it in a log line', async () => {
    const client = answering(500, `<html>${'x'.repeat(5_000)}</html>`)

    const response = await client.getJson('https://api.example.test/thing')
    if (response.status !== 'http-error') throw new Error('expected a failure')

    expect(response.body?.length).toBeLessThan(450)
    expect(response.body?.endsWith('…')).toBe(true)
  })

  it('reports no reason when the server sent an empty body', async () => {
    const client = answering(404, '')

    const response = await client.getJson('https://api.example.test/thing')
    if (response.status !== 'http-error') throw new Error('expected a failure')

    expect(response.body).toBeUndefined()
  })
})

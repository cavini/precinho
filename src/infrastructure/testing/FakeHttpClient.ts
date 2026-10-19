import type { HttpClient, HttpJsonResponse, HttpRequestOptions } from '@/application/ports/HttpClient'

export type FakeRoute = {
  /** Matched against the full URL. */
  match: RegExp
  response: HttpJsonResponse
}

/**
 * Replays canned responses so a gateway can be tested against a recorded
 * payload. Records every URL it was asked for, which is how the query-string
 * assembly gets asserted.
 */
export class FakeHttpClient implements HttpClient {
  readonly requests: Array<{
    url: string
    options?: HttpRequestOptions
    method: 'GET' | 'POST'
    body?: unknown
  }> = []

  constructor(private readonly routes: readonly FakeRoute[]) {}

  async getJson(url: string, options?: HttpRequestOptions): Promise<HttpJsonResponse> {
    return this.record(url, options, 'GET')
  }

  async postJson(
    url: string,
    body: unknown,
    options?: HttpRequestOptions,
  ): Promise<HttpJsonResponse> {
    return this.record(url, options, 'POST', body)
  }

  /** The body is kept so a test can assert what was actually asked for. */
  get lastBody(): unknown {
    return this.requests[this.requests.length - 1]?.body
  }

  private record(
    url: string,
    options: HttpRequestOptions | undefined,
    method: 'GET' | 'POST',
    body?: unknown,
  ): HttpJsonResponse {
    this.requests.push({ url, options, method, body })

    const route = this.routes.find((candidate) => candidate.match.test(url))
    if (!route) return { status: 'network-error', reason: `no fake route for ${url}` }

    return route.response
  }

  get lastUrl(): string {
    return this.requests[this.requests.length - 1]?.url ?? ''
  }
}

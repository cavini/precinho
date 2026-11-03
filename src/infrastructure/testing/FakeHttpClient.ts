import type {
  HttpClient,
  HttpJsonResponse,
  HttpRequestOptions,
  HttpTextResponse,
} from '@/application/ports/HttpClient'

/**
 * A canned response. Headers are optional, because most tests do not care
 * about them and spelling out an empty object everywhere would be noise.
 */
export type FakeResponse =
  | Exclude<HttpJsonResponse, { status: 'ok' }>
  | (Omit<Extract<HttpJsonResponse, { status: 'ok' }>, 'headers'> & {
      headers?: Record<string, string>
    })

export type FakeRoute = {
  /** Matched against the full URL. */
  match: RegExp
  response: FakeResponse
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

  /**
   * Replays the same canned routes, handing back whatever body they hold
   * as text. A route carrying an object is stringified, so a test can
   * write JSONL as an array of lines rather than as an escaped blob.
   */
  async getText(url: string, options?: HttpRequestOptions): Promise<HttpTextResponse> {
    const response = await this.record(url, options, 'GET')
    if (response.status !== 'ok') {
      return response.status === 'invalid-json'
        ? { status: 'network-error', reason: 'unreadable body' }
        : response
    }

    return {
      ...response,
      body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    }
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

    const { response } = route
    return response.status === 'ok' ? { ...response, headers: response.headers ?? {} } : response
  }

  get lastUrl(): string {
    return this.requests[this.requests.length - 1]?.url ?? ''
  }
}

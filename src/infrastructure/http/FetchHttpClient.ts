import type {
  HttpClient,
  HttpJsonResponse,
  HttpRequestOptions,
} from '@/application/ports/HttpClient'
import type { Logger } from '@/application/ports/Logger'

export type FetchHttpClientOptions = {
  /** Applied when a call does not ask for its own. */
  defaultTimeoutMs?: number
  /** Extra attempts after the first. Zero disables retrying. */
  maxRetries?: number
  /** First backoff step; doubles each attempt. */
  retryBaseMs?: number
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>
  fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_MS = 300

/**
 * The real HTTP client, with the three things every outbound call needs and
 * nobody remembers to add: a timeout, bounded retries, and a log line when
 * it gives up.
 *
 * Retries only what retrying can fix — a timeout, a connection failure, or a
 * 5xx. A 4xx is an answer, and asking again just spends somebody else's
 * capacity to get the same no.
 */
export class FetchHttpClient implements HttpClient {
  private readonly defaultTimeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly logger: Logger,
    options: FetchHttpClientOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Complexity: at most 1 + maxRetries requests, with exponential backoff
   * between them.
   */
  async getJson(url: string, options: HttpRequestOptions = {}): Promise<HttpJsonResponse> {
    return this.send(url, options, undefined, this.maxRetries)
  }

  /**
   * Sent once, never retried. Repeating a POST blindly can duplicate a side
   * effect on somebody else's system, and no catalogue read is worth that.
   *
   * Complexity: one request.
   */
  async postJson(
    url: string,
    body: unknown,
    options: HttpRequestOptions = {},
  ): Promise<HttpJsonResponse> {
    return this.send(url, options, JSON.stringify(body), 0)
  }

  private async send(
    url: string,
    options: HttpRequestOptions,
    body: string | undefined,
    maxRetries: number,
  ): Promise<HttpJsonResponse> {
    let lastResponse: HttpJsonResponse = { status: 'network-error', reason: 'not attempted' }

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.retryBaseMs * 2 ** (attempt - 1))
      }

      lastResponse = await this.attempt(url, options, body)
      if (!isWorthRetrying(lastResponse)) return lastResponse

      this.logger.debug('http.retrying', {
        url,
        attempt: attempt + 1,
        result: lastResponse.status,
      })
    }

    this.logger.warn('http.gave_up', {
      url,
      attempts: maxRetries + 1,
      result: lastResponse.status,
    })
    return lastResponse
  }

  private async attempt(
    url: string,
    options: HttpRequestOptions,
    body?: string,
  ): Promise<HttpJsonResponse> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        body,
        headers:
          body === undefined
            ? options.headers
            : { 'Content-Type': 'application/json', ...options.headers },
        signal: controller.signal,
        redirect: 'follow',
      })

      if (!response.ok) {
        return { status: 'http-error', statusCode: response.status }
      }

      try {
        return { status: 'ok', statusCode: response.status, body: await response.json() }
      } catch {
        return { status: 'invalid-json' }
      }
    } catch (error) {
      // An abort here is our own timeout firing.
      if (isAbort(error)) return { status: 'timeout' }
      return { status: 'network-error', reason: describe(error) }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** A 4xx is an answer; only transport failures and 5xx are worth another try. */
function isWorthRetrying(response: HttpJsonResponse): boolean {
  if (response.status === 'timeout' || response.status === 'network-error') return true
  return response.status === 'http-error' && response.statusCode >= 500
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

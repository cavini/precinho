export type HttpRequestOptions = {
  timeoutMs?: number
  headers?: Record<string, string>
}

export type HttpJsonResponse =
  | { status: 'ok'; statusCode: number; body: unknown }
  /** Reached the server, it said no. */
  | { status: 'http-error'; statusCode: number }
  /** Never got an answer: DNS, TLS, connection reset. */
  | { status: 'network-error'; reason: string }
  | { status: 'timeout' }
  /** Answered, but the body was not the JSON we were promised. */
  | { status: 'invalid-json' }

/**
 * Outbound HTTP, narrowed to what the gateways need.
 *
 * A port rather than calling fetch directly, for two reasons: timeouts and
 * retries live in one adapter instead of being re-implemented per store, and
 * a gateway test can replay a recorded payload without a network.
 *
 * Failures are returned, not thrown — a store being down is an expected
 * outcome of a collection run, not an exception.
 */
export interface HttpClient {
  getJson(url: string, options?: HttpRequestOptions): Promise<HttpJsonResponse>
}

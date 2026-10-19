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

  /**
   * Some catalogues only answer a POST — GPA's search takes its terms and
   * its store in a JSON body rather than a query string.
   *
   * Never retried on a transport failure: a POST is not safe to repeat
   * blindly, and no catalogue read is worth risking a duplicate side effect
   * on somebody else's system.
   */
  postJson(url: string, body: unknown, options?: HttpRequestOptions): Promise<HttpJsonResponse>
}

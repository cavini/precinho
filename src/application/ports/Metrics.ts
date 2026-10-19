export type MetricTags = Record<string, string>

/**
 * Counters and timings.
 *
 * Separate from Logger on purpose: a log line answers "what happened in this
 * request", a metric answers "how often, and how slow, across all of them".
 * Collector health and rate-limit rejections are only visible in aggregate.
 */
export interface Metrics {
  increment(name: string, value?: number, tags?: MetricTags): void
  timing(name: string, milliseconds: number, tags?: MetricTags): void
}

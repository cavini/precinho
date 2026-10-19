import type { Logger } from '@/application/ports/Logger'
import type { MetricTags, Metrics } from '@/application/ports/Metrics'

/**
 * Emits metrics as structured log lines.
 *
 * There is no metrics backend on a free hosting tier, and adding one for a
 * first version is a vendor to maintain rather than a problem solved. Both
 * Vercel's log search and GitHub Actions can aggregate on these fields, and
 * swapping in a real sink later means another adapter, not a change above
 * this layer — which is the point of Metrics being a port.
 */
export class LoggingMetrics implements Metrics {
  constructor(private readonly logger: Logger) {}

  increment(name: string, value = 1, tags: MetricTags = {}): void {
    this.logger.info('metric.count', { metric: name, value, ...tags })
  }

  timing(name: string, milliseconds: number, tags: MetricTags = {}): void {
    this.logger.info('metric.timing', { metric: name, ms: milliseconds, ...tags })
  }
}

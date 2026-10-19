import type { MetricTags, Metrics } from '../ports/Metrics'

export type MetricSample = {
  name: string
  value: number
  tags: MetricTags
}

export class RecordingMetrics implements Metrics {
  readonly counters: MetricSample[] = []
  readonly timings: MetricSample[] = []

  increment(name: string, value = 1, tags: MetricTags = {}): void {
    this.counters.push({ name, value, tags })
  }

  timing(name: string, milliseconds: number, tags: MetricTags = {}): void {
    this.timings.push({ name, value: milliseconds, tags })
  }

  /** Total of a counter, optionally narrowed to one tag value. */
  total(name: string, tag?: [string, string]): number {
    return this.counters
      .filter((sample) => sample.name === name)
      .filter((sample) => !tag || sample.tags[tag[0]] === tag[1])
      .reduce((sum, sample) => sum + sample.value, 0)
  }
}

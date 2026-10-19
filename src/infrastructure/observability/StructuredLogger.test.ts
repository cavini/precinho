import { describe, expect, it } from 'vitest'
import { LoggingMetrics } from './LoggingMetrics'
import { StructuredLogger } from './StructuredLogger'

function build(level?: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = []
  const logger = new StructuredLogger({ level, sink: (line) => lines.push(line) })
  const parsed = () => lines.map((line) => JSON.parse(line))
  return { logger, lines, parsed }
}

describe('StructuredLogger', () => {
  it('writes one JSON object per line', () => {
    const { logger, lines, parsed } = build()
    logger.info('search.completed', { resultCount: 3 })

    expect(lines).toHaveLength(1)
    expect(parsed()[0]).toMatchObject({
      level: 'info',
      message: 'search.completed',
      resultCount: 3,
    })
    expect(parsed()[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('keeps the message a stable key so it can be grouped on', () => {
    const { logger, parsed } = build()
    logger.info('store.collected', { storeId: 'mambo', products: 120 })
    logger.info('store.collected', { storeId: 'hortifruti', products: 98 })

    expect(parsed().map((line) => line.message)).toEqual(['store.collected', 'store.collected'])
    expect(parsed().map((line) => line.storeId)).toEqual(['mambo', 'hortifruti'])
  })

  it('drops lines below the configured level', () => {
    const { logger, lines } = build('warn')
    logger.debug('noise')
    logger.info('also noise')
    logger.warn('kept')
    logger.error('kept too')

    expect(lines).toHaveLength(2)
  })

  it('lets debug through when asked', () => {
    const { logger, lines } = build('debug')
    logger.debug('vtex.search_ok', { usable: 20 })
    expect(lines).toHaveLength(1)
  })

  describe('child loggers', () => {
    it('stamp every line with their bound fields', () => {
      const { logger, parsed } = build()
      const run = logger.child({ runId: 'run-7' })

      run.info('store.started', { storeId: 'mambo' })
      expect(parsed()[0]).toMatchObject({ runId: 'run-7', storeId: 'mambo' })
    })

    it('nest, so a run id and a store id both survive', () => {
      const { logger, parsed } = build()
      logger.child({ runId: 'run-7' }).child({ storeId: 'mambo' }).warn('store.failed')

      expect(parsed()[0]).toMatchObject({ runId: 'run-7', storeId: 'mambo' })
    })

    it('do not leak back into the parent', () => {
      const { logger, parsed } = build()
      logger.child({ runId: 'run-7' }).info('scoped')
      logger.info('unscoped')

      expect(parsed()[1].runId).toBeUndefined()
    })

    it('let a call field override a bound one', () => {
      const { logger, parsed } = build()
      logger.child({ storeId: 'mambo' }).info('x', { storeId: 'hortifruti' })
      expect(parsed()[0].storeId).toBe('hortifruti')
    })
  })

  it('omits an absent field rather than writing null', () => {
    // A log search should not have to special-case null for "not set".
    const { logger, parsed } = build()
    logger.info('x', { present: 1, absent: undefined })

    expect(parsed()[0]).not.toHaveProperty('absent')
    expect(parsed()[0].present).toBe(1)
  })

  it('keeps an explicit null, which means something different', () => {
    const { logger, parsed } = build()
    logger.info('x', { cheapestStoreId: null })
    expect(parsed()[0].cheapestStoreId).toBeNull()
  })
})

describe('LoggingMetrics', () => {
  it('emits a counter as a queryable line', () => {
    const { logger, parsed } = build()
    new LoggingMetrics(logger).increment('search.execute', 1, { status: 'ok' })

    expect(parsed()[0]).toMatchObject({
      message: 'metric.count',
      metric: 'search.execute',
      value: 1,
      status: 'ok',
    })
  })

  it('defaults a counter to one', () => {
    const { logger, parsed } = build()
    new LoggingMetrics(logger).increment('search.empty')
    expect(parsed()[0].value).toBe(1)
  })

  it('emits a timing with its duration', () => {
    const { logger, parsed } = build()
    new LoggingMetrics(logger).timing('search.query_ms', 42, { regionId: 'sp' })

    expect(parsed()[0]).toMatchObject({
      message: 'metric.timing',
      metric: 'search.query_ms',
      ms: 42,
    })
  })

  it('carries the bound fields of the logger it was given', () => {
    const { logger, parsed } = build()
    new LoggingMetrics(logger.child({ runId: 'run-7' })).increment('collector.products')
    expect(parsed()[0].runId).toBe('run-7')
  })
})

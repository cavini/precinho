import type { LogFields, Logger } from '@/application/ports/Logger'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Where a line goes. Injected so tests can read what was emitted. */
export type LogSink = (line: string) => void

export type StructuredLoggerOptions = {
  /** Lines below this are dropped. */
  level?: LogLevel
  sink?: LogSink
  /** Stamped on every line from this logger and its children. */
  base?: LogFields
}

/**
 * One JSON object per line.
 *
 * Structured rather than formatted because these lines are read by a log
 * search, not by a person tailing a terminal: "every search over a second"
 * and "which stores failed last night" are queries, and they only work if
 * the message is a stable key and the detail is in fields.
 */
export class StructuredLogger implements Logger {
  private readonly level: LogLevel
  private readonly sink: LogSink
  private readonly base: LogFields

  constructor(options: StructuredLoggerOptions = {}) {
    this.level = options.level ?? 'info'
    this.sink = options.sink ?? ((line) => console.log(line))
    this.base = options.base ?? {}
  }

  debug(message: string, fields: LogFields = {}): void {
    this.write('debug', message, fields)
  }

  info(message: string, fields: LogFields = {}): void {
    this.write('info', message, fields)
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write('warn', message, fields)
  }

  error(message: string, fields: LogFields = {}): void {
    this.write('error', message, fields)
  }

  /**
   * Children carry the parent's fields, which is how a request id reaches
   * every line without being threaded through each signature.
   */
  child(fields: LogFields): Logger {
    return new StructuredLogger({
      level: this.level,
      sink: this.sink,
      base: { ...this.base, ...fields },
    })
  }

  /** Complexity: O(f) in the number of fields. */
  private write(level: LogLevel, message: string, fields: LogFields): void {
    if (SEVERITY[level] < SEVERITY[this.level]) return

    this.sink(
      JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        ...this.base,
        ...prune(fields),
      }),
    )
  }
}

/**
 * Drops undefined so an absent field is absent rather than appearing as
 * null, which a log search would otherwise have to special-case.
 */
function prune(fields: LogFields): LogFields {
  const kept: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) kept[key] = value
  }
  return kept
}

import type { LogFields, Logger } from '../ports/Logger'

export type LogLine = {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  fields: LogFields
}

/**
 * Captures log lines so tests can assert on observability itself — that a
 * rejected request says why, and that a failure is logged at error rather
 * than swallowed.
 */
export class RecordingLogger implements Logger {
  readonly lines: LogLine[] = []

  constructor(private readonly bound: LogFields = {}) {}

  debug(message: string, fields: LogFields = {}): void {
    this.record('debug', message, fields)
  }

  info(message: string, fields: LogFields = {}): void {
    this.record('info', message, fields)
  }

  warn(message: string, fields: LogFields = {}): void {
    this.record('warn', message, fields)
  }

  error(message: string, fields: LogFields = {}): void {
    this.record('error', message, fields)
  }

  child(fields: LogFields): Logger {
    const scoped = new RecordingLogger({ ...this.bound, ...fields })
    // Children share the parent's buffer so a test can read every line.
    Object.defineProperty(scoped, 'lines', { value: this.lines })
    return scoped
  }

  /** Every line whose message matches, for readable assertions. */
  find(message: string): LogLine[] {
    return this.lines.filter((line) => line.message === message)
  }

  private record(level: LogLine['level'], message: string, fields: LogFields): void {
    this.lines.push({ level, message, fields: { ...this.bound, ...fields } })
  }
}

/** Values a log field may hold — structured, never an interpolated sentence. */
export type LogFields = Record<string, string | number | boolean | null | undefined>

/**
 * Structured logging.
 *
 * Messages are stable strings and the varying detail goes in fields, so logs can be
 * queried ("every search that took over a second") rather than grepped.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /**
   * Returns a logger that stamps every line with these fields. This is how
   * a request id or a collection run id reaches every log without being
   * threaded through each function signature.
   */
  child(fields: LogFields): Logger
}

/**
 * Log severity levels, ordered from most to least severe.
 *
 * Numeric values allow direct comparison: lower = more severe, so
 * `candidate <= threshold` means the candidate meets or exceeds
 * the threshold severity.
 */
export enum LogLevel {
  ERROR,
  WARN,
  INFO,
  DEBUG,
}

/** Default log level when no configuration is provided — logs everything. */
export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.DEBUG;

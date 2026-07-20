/**
 * Log severity levels, ordered from most to least severe.
 *
 * Each level has an associated numeric severity — lower = more severe.
 * Use {@link levelSeverity} for comparison-based filtering.
 */

import { LogLevel } from "../config";

/** Default log level when no configuration is provided — logs everything. */
export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.DEBUG;

/** Log levels ordered from most to least severe. */
export const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  LogLevel.SILENT,
  LogLevel.ERROR,
  LogLevel.WARN,
  LogLevel.INFO,
  LogLevel.DEBUG,
];

/**
 * Return the numeric severity of a log level (lower = more severe).
 *
 * Returns -1 for unknown levels so they pass any threshold filter.
 */
export function levelSeverity(level: LogLevel): number {
  const idx = LOG_LEVEL_ORDER.indexOf(level);
  return idx === -1 ? -1 : idx;
}

/**
 * Return `true` when an entry at `candidate` severity meets or exceeds
 * the configured `threshold` (lower numeric severity = more severe).
 *
 * @example
 * shouldLog(LogLevel.ERROR, LogLevel.INFO)  // true  — error meets info threshold
 * shouldLog(LogLevel.DEBUG, LogLevel.WARN)  // false — debug is below warn threshold
 */
export function shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
  return levelSeverity(candidate) <= levelSeverity(threshold);
}

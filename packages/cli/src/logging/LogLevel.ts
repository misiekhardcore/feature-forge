/**
 * Log severity levels, ordered from most to least severe.
 *
 * Severity comparison is delegated to the {@link Logger.LOG_LEVEL_ORDER}
 * numeric precedence map so that string-based enum values are compared
 * correctly (SILENT=0 through DEBUG=4, lower = more severe).
 */

import { LogLevel } from "../config";

/** Default log level when no configuration is provided — logs everything. */
export const DEFAULT_LOG_LEVEL: LogLevel = LogLevel.DEBUG;

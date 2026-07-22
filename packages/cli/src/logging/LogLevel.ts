/**
 * Re-export LogLevel helpers from the shared package.
 *
 * Previously these were defined locally with a dependency on the CLI's
 * LogLevel enum.  Since the enum moved to @feature-forge/shared, this
 * file exists only to avoid breaking existing barrel imports.
 */

export {
  DEFAULT_LOG_LEVEL,
  levelSeverity,
  LOG_LEVEL_ORDER,
  LogLevel,
  shouldLog,
} from "@feature-forge/shared";

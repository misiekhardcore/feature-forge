// ── Re-exports from shared (Logger, LogLevel, helpers) ─────────
export {
  DEFAULT_LOG_LEVEL,
  levelSeverity,
  LOG_LEVEL_ORDER,
  Logger,
  logger,
  LogLevel,
  shouldLog,
} from "@feature-forge/shared";

// ── CLI-specific logging implementations ───────────────────────
export { ConsoleLogger } from "./ConsoleLogger";
export { FileLogger } from "./FileLogger";

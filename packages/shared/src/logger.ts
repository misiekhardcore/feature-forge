/**
 * Logger abstraction shared across all feature-forge packages.
 *
 * Contains the full Logger class, LogLevel enum, and filtering helpers
 * previously siloed in the CLI package.  The CLI layer only needs to call
 * {@link Logger.setDefaultLogLevel} once during startup so that packages
 * without access to ForgeConfig (e.g. @feature-forge/tui) still honour
 * the configured log threshold.
 */

// ── LogLevel ──────────────────────────────────────────────────

/** Log severity levels, ordered from most to least severe. */
export enum LogLevel {
  SILENT = "silent",
  ERROR = "error",
  WARN = "warn",
  INFO = "info",
  DEBUG = "debug",
}

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
 */
export function shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
  return levelSeverity(candidate) <= levelSeverity(threshold);
}

// ── Logger ────────────────────────────────────────────────────

/**
 * Abstract base class for loggers.
 *
 * Defines the contract for four severity methods. Implementations decide
 * how to format and persist log entries (e.g. JSON Lines to file,
 * no-op for tests, console). Packages that need a ready-to-use instance
 * can import the default {@link logger} singleton.
 */
export class Logger {
  protected static instance: Logger | null = null;

  /**
   * Fallback log level used when no explicit level is set on either the
   * singleton instance or the static default.  The CLI start-up code
   * should call {@link setDefaultLogLevel} with the value from
   * ForgeConfig so the entire monorepo shares the same threshold.
   */
  static defaultLogLevel: LogLevel = LogLevel.INFO;

  protected level?: LogLevel;

  protected constructor() {
    if (!Logger.instance) {
      Logger.instance = this;
    }
  }

  /** Return the active logger instance, or throw if not initialised. */
  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error(
        "Logger not initialised. Call Logger.initialize() or construct a subclass first.",
      );
    }
    return Logger.instance;
  }

  /** Create and register a base Logger singleton. */
  static initialize(_options?: Record<string, unknown>): Logger {
    Logger.instance = new Logger();
    return Logger.instance;
  }

  /** Clear the singleton (test teardown only). */
  static resetForTest(): void {
    Logger.instance = null;
  }

  static setLogLevel(level: LogLevel): void {
    Logger.getInstance().level = level;
  }

  static setDefaultLogLevel(level: LogLevel): void {
    Logger.defaultLogLevel = level;
  }

  static getLogLevel(): LogLevel {
    return Logger.getInstance().level ?? Logger.defaultLogLevel;
  }

  /**
   * Log a critical error that prevents normal operation.
   *
   * When the singleton has been replaced by a concrete subclass
   * (e.g. FileLogger), forwards to the active instance so the
   * module-level `logger` const stays functional throughout the
   * extension lifecycle.
   */
  error(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.error(message, data);
    }
  }

  /** Log a warning about a recoverable problem or unexpected state. */
  warn(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.warn(message, data);
    }
  }

  /** Log informational messages about normal operation. */
  info(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.info(message, data);
    }
  }

  /** Log detailed diagnostic information useful for debugging. */
  debug(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.debug(message, data);
    }
  }

  /**
   * Returns `true` when an entry at `candidate` severity meets or exceeds
   * the configured `threshold` (lower numeric severity = more severe).
   */
  protected shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
    return shouldLog(candidate, threshold);
  }
}

/** Default console-based singleton.  Initialised eagerly for convenience. */
export const logger = Logger.initialize();

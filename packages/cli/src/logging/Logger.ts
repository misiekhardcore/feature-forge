import { LogLevel } from "../config";

/**
 * Abstract base class for loggers.
 *
 * Defines the contract for four severity methods. Implementations decide
 * how to format and persist log entries (e.g., JSON Lines to file,
 * no-op for tests).
 *
 * Implementations may apply level filtering to suppress entries below
 * a configurable threshold.
 *
 * @remarks Follows the same abstract base class convention as Agent,
 * WorkspaceProvider, and Tool.
 */
export class Logger {
  protected static instance: Logger | null = null;

  /** Numeric precedence for severity comparisons: lower = more severe. */
  private static readonly LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    [LogLevel.SILENT]: 0,
    [LogLevel.ERROR]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.INFO]: 3,
    [LogLevel.DEBUG]: 4,
  };

  protected level: LogLevel = LogLevel.DEBUG;

  protected constructor() {
    if (!Logger.instance) {
      Logger.instance = this;
    }
  }

  /**
   * Return the active logger instance, or `null` if not initialized.
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error("Logger not initialized. Call Logger.initialize() or a subclass first.");
    }
    return Logger.instance;
  }

  /**
   * Initialize the logger singleton with a new base Logger instance.
   *
   * Concrete subclasses (ConsoleLogger, FileLogger) override this to
   * create their own type. Used by production startup (src/index.ts);
   * tests should construct subclasses directly or call subclass
   * initialize() and {@link resetForTest} in beforeEach.
   */
  static initialize(): Logger {
    Logger.instance = new Logger();
    return Logger.instance;
  }

  /**
   * Clear the singleton so the next {@link initialize} call creates a
   * fresh instance. Only intended for test teardown.
   */
  static resetForTest(): void {
    Logger.instance = null;
  }

  static setLogLevel(level: LogLevel): void {
    Logger.getInstance().level = level;
  }

  static getLogLevel(): LogLevel {
    return Logger.getInstance().level;
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

  /**
   * Log a warning about a recoverable problem or unexpected state.
   *
   * Forwards to the active Logger.instance when it differs from
   * this instance (see {@link error}).
   */
  warn(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.warn(message, data);
    }
  }

  /**
   * Log informational messages about normal operation.
   *
   * Forwards to the active Logger.instance when it differs from
   * this instance (see {@link error}).
   */
  info(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.info(message, data);
    }
  }

  /**
   * Log detailed diagnostic information useful for debugging.
   *
   * Forwards to the active Logger.instance when it differs from
   * this instance (see {@link error}).
   */
  debug(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.debug(message, data);
    }
  }

  /**
   * Returns `true` when an entry at `candidate` severity meets or exceeds
   * the configured `threshold` (lower numeric value = more severe).
   *
   * @example
   * shouldLog(LogLevel.WARN, LogLevel.INFO)  // true  — warn is more severe than info
   * shouldLog(LogLevel.DEBUG, LogLevel.WARN) // false — debug is below warn threshold
   */
  protected shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
    return Logger.LOG_LEVEL_ORDER[candidate] <= Logger.LOG_LEVEL_ORDER[threshold];
  }
}

export const logger = Logger.initialize();

import { DEFAULT_LOG_LEVEL, LogLevel } from "./LogLevel";

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
  protected static instance: Logger;
  protected level: LogLevel;

  protected constructor() {
    if (!Logger.instance) {
      Logger.instance = this;
    }
    this.level = this.parseLogLevel(process.env.FEATURE_FORGE_LOG_LEVEL) ?? DEFAULT_LOG_LEVEL;
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
    Logger.instance = undefined as unknown as Logger;
  }

  static setLogLevel(level: LogLevel): void {
    Logger.instance.level = level;
  }

  static getLogLevel(): LogLevel {
    return Logger.instance.level;
  }

  /** Log a critical error that prevents normal operation. */
  error(_message: string, _data?: Record<string, unknown>): void {}

  /** Log a warning about a recoverable problem or unexpected state. */
  warn(_message: string, _data?: Record<string, unknown>): void {}

  /** Log informational messages about normal operation. */
  info(_message: string, _data?: Record<string, unknown>): void {}

  /** Log detailed diagnostic information useful for debugging. */
  debug(_message: string, _data?: Record<string, unknown>): void {}

  /**
   * Parse a log level from a raw string value.
   *
   * Case-insensitive. Returns `undefined` for unrecognised input so
   * callers can fall back to {@link DEFAULT_LOG_LEVEL}.
   */
  protected parseLogLevel(raw: string | undefined): LogLevel | undefined {
    if (!raw) return undefined;
    const normalised = raw.toLowerCase().trim();
    const key = normalised.toUpperCase();
    if (key in LogLevel) {
      return LogLevel[key as keyof typeof LogLevel];
    }
    return undefined;
  }

  /**
   * Returns `true` when an entry at `candidate` severity meets or exceeds
   * the configured `threshold` (lower numeric value = more severe).
   *
   * @example
   * shouldLog(LogLevel.WARN, LogLevel.INFO)  // false — warn is below info threshold
   * shouldLog(LogLevel.ERROR, LogLevel.WARN) // true  — error meets warn threshold
   */
  protected shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
    return candidate <= threshold;
  }
}

export const logger = Logger.initialize();

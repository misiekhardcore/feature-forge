import { ForgeConfig } from "../config";
// ForgeConfig's LogLevel is string-based ("info", "debug", etc.) while
// the Logger's LogLevel is numeric. The parseLogLevel method handles
// the conversion for both env var strings and config strings.
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
  protected static instance: Logger | null = null;
  protected level: LogLevel;

  protected constructor() {
    if (!Logger.instance) {
      Logger.instance = this;
    }
    this.level = this.resolveLogLevel();
  }

  /**
   * Return the active logger instance, or `null` if not initialized.
   */
  static getInstance(): Logger | null {
    return Logger.instance;
  }

  /**
   * Resolve the effective log level by checking, in order:
   * 1. ForgeConfig (if initialized)
   * 2. FORGE_LOG_LEVEL environment variable
   * 3. DEFAULT_LOG_LEVEL
   */
  private resolveLogLevel(): LogLevel {
    const configInstance = ForgeConfig.tryGetInstance();
    if (configInstance) {
      // ForgeConfig.LogLevel is a string enum — parseLogLevel handles
      // the conversion to numeric LogLevel via the shared key names.
      return this.parseLogLevel(configInstance.getLogLevel()) ?? DEFAULT_LOG_LEVEL;
    }
    return this.parseLogLevel(process.env.FORGE_LOG_LEVEL) ?? DEFAULT_LOG_LEVEL;
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

  /**
   * Return the active logger singleton, or throw if not initialized.
   *
   * @throws Error if no logger instance has been created via
   *   {@link initialize} or a subclass's initialize().
   */
  static getRequiredInstance(): Logger {
    if (!Logger.instance) {
      throw new Error("Logger not initialized. Call Logger.initialize() or a subclass first.");
    }
    return Logger.instance;
  }

  static setLogLevel(level: LogLevel): void {
    Logger.getRequiredInstance().level = level;
  }

  static getLogLevel(): LogLevel {
    return Logger.getRequiredInstance().level;
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

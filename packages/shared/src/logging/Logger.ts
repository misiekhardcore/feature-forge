import { LogLevel } from "../config/ForgeConfigSchema";
import { shouldLog } from "./LogLevel";

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
 * While no concrete logger is initialized, the base instance itself
 * prints to the console - entries emitted during startup (e.g. config
 * warnings before {@link FileLogger} initialization) must not be
 * dropped.
 *
 * @remarks Follows the same abstract base class convention as Agent,
 * WorkspaceProvider, and Tool.
 */
export class Logger {
  protected static instance: Logger | null = null;
  protected level?: LogLevel;

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

  /**
   * Return the effective log level threshold.
   *
   * Prefers an explicitly set level; defaults to {@link LogLevel.INFO}
   * (the config schema default) when no level is set or no logger
   * instance exists yet. Concrete loggers apply the configured level
   * during initialization - the level is never read from ForgeConfig
   * on a per-call basis.
   */
  static getLogLevel(): LogLevel {
    return Logger.instance?.level ?? LogLevel.INFO;
  }

  /**
   * Log a critical error that prevents normal operation.
   *
   * When the singleton has been replaced by a concrete subclass
   * (e.g. FileLogger), forwards to the active instance so the
   * module-level `logger` const stays functional throughout the
   * extension lifecycle. While the base logger is still the active
   * instance, prints to the console instead (see {@link logToConsole}).
   */
  error(message: string, data?: Record<string, unknown>): void {
    if (Logger.instance && Logger.instance !== this) {
      Logger.instance.error(message, data);
      return;
    }
    this.logToConsole(LogLevel.ERROR, console.error, message, data);
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
      return;
    }
    this.logToConsole(LogLevel.WARN, console.warn, message, data);
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
      return;
    }
    this.logToConsole(LogLevel.INFO, console.info, message, data);
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
      return;
    }
    this.logToConsole(LogLevel.DEBUG, console.debug, message, data);
  }

  /**
   * Print an entry to the console when it meets the effective log
   * level threshold.
   *
   * Shared by the base logger (console fallback while it is the active
   * instance) and {@link ConsoleLogger}, so the filtering logic lives
   * in exactly one place. `data` is omitted from the console call when
   * undefined so plain messages print cleanly.
   */
  protected logToConsole(
    level: LogLevel,
    consoleMethod: (message?: unknown, ...optionalParams: unknown[]) => void,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.shouldLog(level, Logger.getLogLevel())) {
      return;
    }
    if (data === undefined) {
      consoleMethod(message);
    } else {
      consoleMethod(message, data);
    }
  }

  /**
   * Returns `true` when an entry at `candidate` severity meets or exceeds
   * the configured `threshold` (lower numeric severity = more severe).
   *
   * Delegates to the standalone {@link shouldLog} helper so both
   * {@link Logger} and {@link FileLogger} use the same comparison.
   */
  protected shouldLog(candidate: LogLevel, threshold: LogLevel): boolean {
    return shouldLog(candidate, threshold);
  }
}

export const logger = Logger.initialize();

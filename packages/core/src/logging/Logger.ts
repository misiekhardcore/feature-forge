import { LogLevel } from "../config/ForgeConfigSchema";
import { shouldLog } from "./LogLevel";

/**
 * Sink receiving formatted log entries from a {@link Logger}.
 *
 * Implementations persist entries (e.g. JSON Lines to a file) without
 * applying level filtering - the {@link Logger} filters before delegating,
 * so a destination writes whatever it is handed.
 */
export interface LoggerDestination {
  /** Write one entry at `level`. Must not throw. */
  write(level: LogLevel, message: string, data?: Record<string, unknown>): void;
  /** Stop accepting entries; writes after close are best-effort no-ops. */
  close(): void | Promise<void>;
}

/**
 * Level-filtering logger that routes entries to its own destination.
 *
 * Owns both the severity threshold and the sink: severity methods filter
 * against the instance's own {@link level} and write to the instance's own
 * {@link destination}. When no destination is attached the entry is
 * printed to the console instead, so entries emitted during startup
 * (before {@link FileLogger.install} attaches a file destination) are
 * never dropped.
 *
 * The level defaults to {@link LogLevel.INFO} (the config schema default);
 * {@link LogLevel.SILENT} suppresses every entry.
 *
 * The module exports a single shared instance (`logger`) that production
 * code logs through; tests construct their own instances to isolate
 * level/destination state.
 */
export class Logger {
  private level: LogLevel = LogLevel.INFO;
  private destination: LoggerDestination | undefined;

  /** Log a critical error that prevents normal operation. */
  error(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.ERROR, message, data);
  }

  /** Log a warning about a recoverable problem or unexpected state. */
  warn(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.WARN, message, data);
  }

  /** Log informational messages about normal operation. */
  info(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.INFO, message, data);
  }

  /** Log detailed diagnostic information useful for debugging. */
  debug(message: string, data?: Record<string, unknown>): void {
    this.emit(LogLevel.DEBUG, message, data);
  }

  /**
   * Filter one entry against this instance's level and route it to this
   * instance's destination - or to the console when no destination is
   * attached. `data` is omitted from the console call when undefined so
   * plain messages print cleanly.
   */
  private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level, this.level)) {
      return;
    }
    if (this.destination) {
      this.destination.write(level, message, data);
      return;
    }
    const method =
      level === LogLevel.ERROR
        ? console.error
        : level === LogLevel.WARN
          ? console.warn
          : level === LogLevel.INFO
            ? console.info
            : console.debug;
    if (data === undefined) {
      method(message);
    } else {
      method(message, data);
    }
  }

  /** Set the severity threshold for this instance. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Return the current severity threshold of this instance. */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Partial-update the level and/or destination: each key is applied only
   * when present. An omitted `level` leaves the threshold unchanged; an
   * omitted `destination` leaves the current destination attached, so
   * level-only calls never silently detach a file destination. Pass an
   * explicit `destination: null` (or `undefined`) to detach any
   * destination and return to the console fallback. Detaching does not
   * close the displaced sink; use {@link close} on shutdown, which closes
   * the destination but leaves it attached.
   */
  configure(options: { level?: LogLevel; destination?: LoggerDestination | null }): void {
    // Deliberate asymmetry: `level` guards with `!== undefined`, so omitting
    // it (or passing `level: undefined`) is a no-op; `destination` checks key
    // presence (`"destination" in options`), so an explicit
    // `destination: null`/`undefined` detaches while an omitted key leaves
    // the current destination attached.
    if (options.level !== undefined) {
      this.level = options.level;
    }
    if ("destination" in options) {
      this.destination = options.destination ?? undefined; // null/undefined => console fallback
    }
  }

  /** Stop the destination (when one is attached). Writes after close are best-effort no-ops. */
  async close(): Promise<void> {
    await this.destination?.close();
  }
}

/** Single shared instance; console-only until a file destination is attached. */
export const logger = new Logger();

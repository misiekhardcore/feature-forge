import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger } from "./Logger";

/**
 * Logger that writes messages to stdout/stderr via console methods.
 *
 * Every severity method maps to the corresponding console method
 * (console.error, console.warn, console.info, console.debug).
 * Only entries at or above the effective log level are printed,
 * mirroring {@link FileLogger} level filtering.
 *
 * The level defaults to {@link LogLevel.INFO} until
 * {@link Logger.setLogLevel} is called; {@link FileLogger.initialize}
 * applies the configured level, so a standalone ConsoleLogger used
 * before configuration is loaded still prints warnings and errors.
 * Designed for use in interactive sessions or environments where
 * file logging is not available.
 */
export class ConsoleLogger extends Logger {
  static initialize(): ConsoleLogger {
    Logger.instance = new ConsoleLogger();
    return Logger.instance;
  }

  override error(message: string, data?: Record<string, unknown>): void {
    this.logToConsole(LogLevel.ERROR, console.error, message, data);
  }

  override warn(message: string, data?: Record<string, unknown>): void {
    this.logToConsole(LogLevel.WARN, console.warn, message, data);
  }

  override info(message: string, data?: Record<string, unknown>): void {
    this.logToConsole(LogLevel.INFO, console.info, message, data);
  }

  override debug(message: string, data?: Record<string, unknown>): void {
    this.logToConsole(LogLevel.DEBUG, console.debug, message, data);
  }
}

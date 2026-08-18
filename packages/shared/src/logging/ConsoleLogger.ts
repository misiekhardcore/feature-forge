import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger } from "./Logger";

/**
 * Logger that writes messages to stdout/stderr via console methods.
 *
 * Every severity method maps to the corresponding console method
 * (console.error, console.warn, console.info, console.debug).
 * Only entries at or above the configured log level are printed,
 * mirroring {@link FileLogger} level filtering.
 * Designed for use in interactive sessions or environments where
 * file logging is not available.
 */
export class ConsoleLogger extends Logger {
  static initialize(): ConsoleLogger {
    Logger.instance = new ConsoleLogger();
    return Logger.instance;
  }

  override error(message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(LogLevel.ERROR, Logger.getLogLevel())) {
      return;
    }
    console.error(message, data);
  }

  override warn(message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(LogLevel.WARN, Logger.getLogLevel())) {
      return;
    }
    console.warn(message, data);
  }

  override info(message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(LogLevel.INFO, Logger.getLogLevel())) {
      return;
    }
    console.info(message, data);
  }

  override debug(message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(LogLevel.DEBUG, Logger.getLogLevel())) {
      return;
    }
    console.debug(message, data);
  }
}

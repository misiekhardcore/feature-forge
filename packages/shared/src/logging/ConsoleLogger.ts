import { Logger } from "./logger";

/**
 * Logger that writes messages to stdout/stderr via console methods.
 *
 * Every severity method maps to the corresponding console method
 * (console.error, console.warn, console.info, console.debug).
 * Designed for use in interactive sessions or environments where
 * file logging is not available.
 */
export class ConsoleLogger extends Logger {
  static initialize(_options?: Record<string, unknown>): ConsoleLogger {
    Logger.instance = new ConsoleLogger();
    return Logger.instance;
  }

  override error(message: string, data?: Record<string, unknown>): void {
    console.error(message, data);
  }

  override warn(message: string, data?: Record<string, unknown>): void {
    console.warn(message, data);
  }

  override info(message: string, data?: Record<string, unknown>): void {
    console.info(message, data);
  }

  override debug(message: string, data?: Record<string, unknown>): void {
    console.debug(message, data);
  }
}

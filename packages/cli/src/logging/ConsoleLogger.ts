import { Logger } from "./Logger";

/**
 * Logger that discards all messages — zero overhead, no side effects.
 *
 * Designed for tests where logging would be noise. Every severity method
 * is a no-op; nothing is written, stored, or forwarded.
 */
export class ConsoleLogger extends Logger {
  static initialize(): ConsoleLogger {
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

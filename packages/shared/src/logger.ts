/**
 * Minimal logger interface used across feature-forge packages.
 *
 * Each package can provide its own implementation. The default
 * implementation exported as `logger` delegates to `console`.
 */
export interface Logger {
  warn(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console-based logger suitable for packages without access
 * to the CLI's structured FileLogger.
 */
export const logger: Logger = {
  warn(message: string, data?: Record<string, unknown>) {
    if (data) {
      console.warn(message, data);
    } else {
      console.warn(message);
    }
  },
};

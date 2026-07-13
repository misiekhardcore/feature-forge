/**
 * Typed error hierarchy for configuration operations.
 *
 * All errors extend {@link ConfigError} so callers can catch broadly
 * or inspect the specific subclass.
 */

export class ConfigError extends Error {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "ConfigError";
    this.cause = cause;
  }
}

/**
 * A required configuration key is missing and no default exists.
 */
export class MissingConfigError extends ConfigError {
  constructor(key: string, cause?: Error) {
    super(`Missing required configuration key: ${key}`, cause);
    this.name = "MissingConfigError";
  }
}

/**
 * A required configuration file could not be found at the specified path.
 */
export class MissingConfigFileError extends ConfigError {
  constructor(filePath: string, cause?: Error) {
    super(`Configuration file not found: ${filePath}`, cause);
    this.name = "MissingConfigFileError";
  }
}

/**
 * A configuration value failed validation against the schema.
 */
export class InvalidConfigError extends ConfigError {
  constructor(key: string, expected: string, actual: unknown, cause?: Error) {
    const actualStr = typeof actual === "string" ? `"${actual}"` : String(actual);
    super(`Invalid configuration for "${key}": expected ${expected}, got ${actualStr}`, cause);
    this.name = "InvalidConfigError";
  }
}

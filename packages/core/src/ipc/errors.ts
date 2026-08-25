/**
 * Error types for the Unix socket IPC layer.
 */

/**
 * Thrown when a socket request times out before receiving a response.
 */
export class IpcTimeoutError extends Error {
  public readonly correlationId: string;

  constructor(correlationId: string, ms: number) {
    super(`IPC request ${correlationId} timed out after ${ms}ms`);
    this.name = "IpcTimeoutError";
    this.correlationId = correlationId;
  }
}

/**
 * Thrown when a socket connection cannot be established.
 */
export class IpcConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "IpcConnectionError";
  }
}

/**
 * Thrown when the server sends an error response for a request.
 */
export class IpcRequestError extends Error {
  public readonly correlationId: string;

  constructor(correlationId: string, message: string) {
    super(`IPC request ${correlationId} failed: ${message}`);
    this.name = "IpcRequestError";
    this.correlationId = correlationId;
  }
}

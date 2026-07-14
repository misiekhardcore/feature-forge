/**
 * Error thrown when instruction nesting exceeds the maximum allowed depth.
 */
export class MaxDepthExceededError extends Error {
  static readonly MAX_NESTING_DEPTH = 10;

  readonly name = "MaxDepthExceededError";

  constructor(depth: number, options?: ErrorOptions) {
    super(
      `Instruction nesting depth ${depth} exceeds maximum of ${MaxDepthExceededError.MAX_NESTING_DEPTH}`,
      options,
    );
  }
}

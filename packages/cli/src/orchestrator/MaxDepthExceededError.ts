/**
 * Maximum depth for nested cross-flow routine calls before aborting.
 * This prevents infinite mutual-recursion between flows via circular
 * routine references.
 */
export const MAX_NESTING_DEPTH = 10;

/**
 * Raised when a cross-flow routine call would exceed the maximum
 * nesting depth configured in {@link MAX_NESTING_DEPTH}.
 */
export class MaxDepthExceededError extends Error {
  constructor(depth: number) {
    super(`Maximum routine nesting depth (${MAX_NESTING_DEPTH}) exceeded at depth ${depth}`);
    this.name = "MaxDepthExceededError";
  }
}

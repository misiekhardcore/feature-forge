/**
 * Thrown when a `type: "routine"` instruction would exceed the maximum
 * nesting depth, guarding against infinite recursion in flow composition.
 */
export class MaxDepthExceededError extends Error {
  constructor(depth: number, maxDepth: number, target: string) {
    super(
      `Max nesting depth exceeded: routine ref to "${target}" at depth ${depth} ` +
        `(max ${maxDepth}). Possible circular flow composition.`,
    );
    this.name = "MaxDepthExceededError";
  }
}

export const MAX_NESTING_DEPTH = 10;

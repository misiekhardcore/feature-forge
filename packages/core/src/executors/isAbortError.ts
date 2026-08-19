/**
 * Type guard that checks whether an error is an {@link DOMException} with
 * name `"AbortError"`.
 *
 * Used by step executors to distinguish user-initiated abort signals
 * from genuine execution failures so that abort signals are propagated
 * immediately rather than translated into failure results.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

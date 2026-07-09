import { logger } from "../logging";
import { FlowContext } from "./FlowContext";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "./MaxDepthExceededError";

/**
 * Create a fresh {@link FlowContext} for a child routine call.
 *
 * The child context is initialised with:
 * - An empty results map (clean slate).
 * - The parent's workspace references (shared).
 * - An empty params map — child routine params come from `input`.
 * - Depth incremented by 1, respecting {@link MAX_NESTING_DEPTH}.
 * - A fresh {@link FlowStateStore} so the child doesn't mutate the parent's
 *   session directly (session results are merged via the parent routine's
 *   result handling).
 *
 * @throws {MaxDepthExceededError} when the resulting depth would exceed the limit.
 */
export function createChildExecutionContext(
  parent: FlowContext,
  feedbackProvider?: () => Promise<string>,
): FlowContext {
  const nextDepth = parent.depth + 1;

  if (nextDepth > MAX_NESTING_DEPTH) {
    throw new MaxDepthExceededError(nextDepth);
  }

  logger.debug("Creating child execution context", {
    parentDepth: parent.depth,
    childDepth: nextDepth,
  });

  return new FlowContext({
    results: new Map(),
    prompt: parent.prompt,
    workspaces: parent.workspaces,
    params: new Map(),
    feedback: undefined,
    feedbackProvider,
    iteration: 0,
    depth: nextDepth,
  });
}

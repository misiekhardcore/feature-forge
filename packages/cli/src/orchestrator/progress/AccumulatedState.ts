/**
 * Accumulated, derived progress state consumed by the TUI renderer.
 *
 * This is the single contract between step executors (who register handlers
 * on a {@link DisplayContributionRegistry}) and the renderer (who reads
 * these fields). Built from contributions via registered handlers.
 */
export interface AccumulatedState {
  /** Agent ID → current status, summary, and parse result. */
  readonly agentMap: Map<string, { status: string; summary?: string; passed?: boolean }>;
  /** Current iteration index (0-based). */
  iteration: number;
  /** Maximum number of loop iterations, or 0 if not a looped routine. */
  maxIterations: number;
  /** Current workspace path, if one has been provisioned. */
  workspace?: string;
  /** Branch name associated with the workspace, if set. */
  branch?: string;
  /** Loop continueWhile expression, if the routine uses a loop. */
  continueWhile?: string;
}

/**
 * Create a default/empty {@link AccumulatedState}.
 *
 * The returned object is a fresh mutable instance — the caller
 * (or the registry) owns and mutates it.
 */
export function createAccumulatedState(): AccumulatedState {
  return {
    agentMap: new Map(),
    iteration: 0,
    maxIterations: 0,
    workspace: undefined,
    branch: undefined,
    continueWhile: undefined,
  };
}

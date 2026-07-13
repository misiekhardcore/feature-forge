/**
 * Accumulated rendering state derived from a sequence of
 * {@link import("./DisplayContribution").DisplayContribution} records
 * through a {@link import("./DisplayContributionRegistry").DisplayContributionRegistry}.
 *
 * Each handler registered in the registry knows how to update the
 * relevant field(s) of this state for its contribution type.
 */
export interface AccumulatedState {
  /** Agent id → {status, summary, passed} — later contributions overwrite.
   * Status may be undefined for stream-only contributions with no lifecycle state. */
  readonly agentMap: ReadonlyMap<
    string,
    { readonly status?: string; readonly summary?: string; readonly passed?: boolean }
  >;
  /** Latest loop iteration index (0-based). */
  readonly iteration: number;
  /** Maximum number of loop iterations. */
  readonly maxIterations: number;
  /** Latest workspace path, if one has been provisioned. */
  readonly workspacePath: string | undefined;
  /** Latest branch name associated with the workspace. */
  readonly branch: string | undefined;
  /** Latest continueWhile expression from the loop instruction. */
  readonly continueWhile: string | undefined;
}

/**
 * Mutable counterpart of {@link AccumulatedState} used by registry
 * handlers during accumulation.
 *
 * Handlers registered via
 * {@link import("./DisplayContributionRegistry").DisplayContributionRegistry.register}
 * receive this type and may mutate it in place.
 */
export interface MutableState {
  agentMap: Map<string, { status?: string; summary?: string; passed?: boolean }>;
  iteration: number;
  maxIterations: number;
  workspacePath: string | undefined;
  branch: string | undefined;
  continueWhile: string | undefined;
}

/**
 * Create a fresh mutable state with default values.
 */
export function createMutableState(): MutableState {
  return {
    agentMap: new Map(),
    iteration: 0,
    maxIterations: 0,
    workspacePath: undefined,
    branch: undefined,
    continueWhile: undefined,
  };
}

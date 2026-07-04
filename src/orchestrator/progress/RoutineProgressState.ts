/**
 * Live progress state consumed by {@link import("./ProgressRenderer").ProgressRenderer}.
 *
 * The owning tool (e.g. {@link import("../RoutineTool").RoutineTool}) implements
 * this interface and passes itself to the renderer constructor. All properties
 * are read-only from the renderer's perspective.
 */
export interface RoutineProgressState {
  /** Routine name (e.g. "run_build_loop"). */
  readonly routineName: string;

  /** Agents tracked during execution, keyed by instruction id. */
  readonly agentState: ReadonlyMap<string, { status: string; summary?: string }>;

  /** Current loop iteration (0-based). */
  readonly iteration: number;

  /** Maximum loop iterations. 0 when there is no loop. */
  readonly maxIterations: number;

  /** Path to the current workspace, if one was created. */
  readonly workspace: string | undefined;

  /** The `continueWhile` expression from the loop instruction, if any. */
  readonly continueWhile: string | undefined;
}

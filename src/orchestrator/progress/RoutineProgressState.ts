import type { DisplayContribution } from "./DisplayContribution";

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

  /**
   * Accumulated {@link DisplayContribution} records from all step executors,
   * in the order they were received. The renderer derives agent state,
   * iteration counters, workspace path, and continueWhile from these records.
   */
  readonly contributions: readonly DisplayContribution[];
}

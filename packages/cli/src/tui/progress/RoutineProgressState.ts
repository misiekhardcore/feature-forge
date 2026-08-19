import type { AccumulatedState } from "./AccumulatedState";

/**
 * Live progress state consumed by {@link import("./ProgressRenderer").ProgressRenderer}.
 *
 * The owning tool (e.g. {@link import("../../tools/RoutineTool").RoutineTool}) implements
 * this interface and passes itself to the renderer constructor. All properties
 * are read-only from the renderer's perspective.
 */
export interface RoutineProgressState {
  /** Routine name (e.g. "run_build_loop"). */
  readonly routineName: string;

  /**
   * Live accumulated progress state, folded from the event stream by the
   * owning tool. The renderer reads it without mutating.
   */
  readonly accumulatedState: AccumulatedState;
}

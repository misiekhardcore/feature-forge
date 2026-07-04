import type { InstructionResult } from "./FlowContext";
import type { FlowParams } from "./FlowStateStore";

/**
 * The structured result produced by executing one routine to completion.
 *
 * Returned to the orchestrator LLM via a RoutineTool. The LLM reads these
 * fields to decide which routine to call next.
 */
export interface RoutineResult {
  /** Name of the routine that was executed. */
  routine: string;
  /** Whether the routine completed successfully. */
  passed: boolean;
  /** Number of loop rounds completed (0 if no loop). */
  rounds: number;
  /** Named worktree path produced by the routine (if any). */
  workspace?: string;
  /** Per-instruction outputs from the final iteration. */
  results: Record<string, InstructionResult>;
  /** Human-readable digest for the orchestrator LLM. */
  summary: string;
  /** Flow-global session state at routine completion. */
  session: FlowParams;
}

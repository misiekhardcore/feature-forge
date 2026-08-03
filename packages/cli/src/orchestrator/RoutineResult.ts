import type { AgentEvent } from "@earendil-works/pi-agent-core";

import type { InstructionResult } from "./FlowContext";
import type { FlowParams } from "./FlowStateStore";

/**
 * Three-state outcome of a routine execution:
 * - "success" — every step passed;
 * - "skipped" — the routine completed without failing, but one or more
 *   steps were skipped (e.g. a loop whose while-guard evaluated false);
 * - "failed" — a step threw or reported a failed result.
 */
export type RoutineStatus = "success" | "skipped" | "failed";

/**
 * The structured result produced by executing one routine to completion.
 *
 * Returned to the orchestrator LLM via a RoutineTool. The LLM reads these
 * fields to decide which routine to call next.
 */
export interface RoutineResult {
  /** Name of the routine that was executed. */
  routine: string;
  /**
   * Whether the routine completed successfully.
   *
   * Backwards-compatible projection of {@link status}: `true` for both
   * "success" and "skipped", `false` for "failed".
   */
  passed: boolean;
  /**
   * Three-state outcome of the routine. Derived from `passed` plus any
   * skipped step indicators: "failed" wins over "skipped".
   */
  status: RoutineStatus;
  /**
   * Human-readable explanation for a non-success status. Populated for
   * "skipped" (naming the skipped step id(s)); undefined for "success".
   */
  reason?: string;
  /** Number of loop rounds completed (0 if no loop). */
  rounds: number;
  /** Named worktree path produced by the routine (if any). */
  workspace?: string;
  /** Branch name associated with the workspace, if set. */
  branch?: string;
  /** PR URL extracted from a shell step output, if present. */
  prUrl?: string;
  /** Per-instruction outputs from the final iteration. */
  results: Record<string, InstructionResult>;
  /** Human-readable digest for the orchestrator LLM. */
  summary: string;
  /** Flow-global session state at routine completion. */
  session: FlowParams;
  /**
   * Unique execution identifier generated per agent step invocation.
   *
   * Populated only in {@link import("./RoutineProgress").RoutineProgressEvent.details}
   * for structural compatibility with progress-event transport. When reading
   * a {@link RoutineResult} returned by {@link import("./RoutineExecutor").RoutineExecutor.run},
   * this field is always `undefined` — the final result does not carry
   * per-step execution identifiers.
   */
  executionId?: string;
  /** Agent instruction id carried by agent-stream events. */
  agentId?: string;
  /** Agent role label carried by agent-stream events. */
  label?: string;
  /** Raw agent event payload carried by agent-stream events. */
  event?: AgentEvent;
}

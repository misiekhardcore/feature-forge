import type { InstructionResult, ParsedResult } from "./FlowContext";

/**
 * The structured result returned after executing a single routine.
 *
 * The orchestrator (LLM) reads this blob to decide the next tool call.
 */
export interface RoutineResult {
  /** Name of the routine that ran. */
  routine: string;
  /** Top-level success indicator. */
  passed: boolean;
  /** Number of loop iterations executed, if the routine contains a loop. */
  rounds?: number;
  /** Absolute path to the workspace directory, if created by this routine. */
  workspace?: string;
  /** Per-instruction outputs keyed by instruction id. */
  results: Record<string, InstructionResult>;
  /** Human-readable digest the LLM ingests between routine calls. */
  summary: string;
}

/**
 * Check whether a parsed result indicates pass/fail.
 *
 * Used by RoutineExecutor to compute the top-level `passed` flag.
 */
export function isParsedResultPassed(parsed: ParsedResult): boolean {
  if ("kind" in parsed && (parsed.kind === "review" || parsed.kind === "build")) {
    return parsed.passed;
  }
  return true;
}

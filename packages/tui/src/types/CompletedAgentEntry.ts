import type { AgentEntryBase } from "./AgentEntryBase";

/**
 * Agent entry for an agent that has completed successfully.
 *
 * Status is "done" and includes pass/fail status and summary.
 */
export interface CompletedAgentEntry extends AgentEntryBase {
  /** Lifecycle status - always "done" for completed agents. */
  status: "done";
  /** Whether the agent's parsed result passed. */
  passed: boolean;
  /** One-line summary from the completed agent step. */
  summary: string;
}

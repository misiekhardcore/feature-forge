import type { AgentEntryBase } from "./AgentEntryBase";

/**
 * Agent entry for an agent that has started but not yet completed.
 *
 * Status is "started" and includes streaming state information.
 */
export interface RunningAgentEntry extends AgentEntryBase {
  /** Lifecycle status - always "started" for running agents. */
  status: "started";
  /** Most recent formatted stream line for this agent. */
  lastStreamLine?: string;
}

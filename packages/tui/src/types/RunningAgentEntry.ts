import type { AgentEntryBase } from "./AgentEntryBase";

/**
 * Agent entry for an agent that has started but not yet completed.
 *
 * Status is "started" or "running" and includes streaming state information.
 */
export interface RunningAgentEntry extends AgentEntryBase {
  /** Lifecycle status - "started" or "running" for in-flight agents. */
  status: "started" | "running";
  /** Most recent formatted stream line for this agent. */
  lastStreamLine?: string;
}

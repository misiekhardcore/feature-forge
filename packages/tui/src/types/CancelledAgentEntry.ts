import type { AgentEntryBase } from "./AgentEntryBase";

/**
 * Agent entry for an agent that has been externally cancelled.
 *
 * Status is "cancelled" and may include an optional summary.
 */
export interface CancelledAgentEntry extends AgentEntryBase {
  /** Lifecycle status - always "cancelled" for cancelled agents. */
  status: "cancelled";
  /** Optional summary of the cancellation. */
  summary?: string;
}

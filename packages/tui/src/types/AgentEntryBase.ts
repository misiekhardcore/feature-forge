import { AgentSpecification } from "@feature-forge/cli/src/agents";

/**
 * Base interface for agent entries managed by the viewer.
 *
 * Contains fields common to all agent lifecycle states.
 */
export interface AgentEntryBase {
  /** Agent instruction id (e.g. "builder", "reviewer"). */
  id: string;
  /** Display role for the agent (e.g. "builder", "reviewer"). */
  role?: string;
  /** Agent specification used to create this agent. */
  specification?: AgentSpecification;
  /** Timestamp when the agent entry was created. */
  createdAt: Date;
  /** Optional raw output from the agent (truncated for display). */
  raw?: string;
  /** Optional elapsed time string (e.g. "2m 14s"). */
  elapsed?: string;
  /** Whether the agent's parsed result passed (undefined when not available). */
  passed?: boolean;
  /** Optional one-line summary from a completed or errored agent step. */
  summary?: string;
}

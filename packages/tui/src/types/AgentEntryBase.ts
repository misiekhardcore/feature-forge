import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

/**
 * Base interface for agent entries managed by the viewer.
 *
 * Contains only fields common to all agent lifecycle states.
 * Variant-specific fields like `passed` live on the concrete subtype
 * ({@link CompletedAgentEntry}) where they are semantically meaningful.
 */
export interface AgentEntryBase {
  /** Agent instruction id (e.g. "builder", "reviewer"). */
  id: string;
  /** Display role for the agent (e.g. "builder", "reviewer"). */
  role?: string;
  /** Model pattern used by this agent (e.g. "claude-sonnet-4-5"). Undefined = default. */
  model?: string;
  /** Thinking/reasoning level used by this agent. Undefined = default. */
  thinkingLevel?: ThinkingLevel;
  /** Timestamp when the agent entry was created. */
  createdAt: Date;
  /** Timestamp when the agent finished (set on done/error, undefined while running). */
  finishedAt?: Date;
  /** Optional one-line summary from a completed or errored agent step. */
  summary?: string;
}

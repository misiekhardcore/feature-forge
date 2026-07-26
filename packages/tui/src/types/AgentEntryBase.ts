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
  /** Timestamp when the agent entry was created. */
  createdAt: Date;
  /** Frozen elapsed time string for completed/errored agents (e.g. "2m 14s"). */
  elapsed?: string;
  /** Optional one-line summary from a completed or errored agent step. */
  summary?: string;
}

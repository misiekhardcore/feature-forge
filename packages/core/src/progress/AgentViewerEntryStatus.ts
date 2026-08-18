/**
 * Lifecycle statuses an agent entry can take in the viewer.
 *
 * This is the display-status vocabulary shared by the projection/accumulated
 * state and the viewer types: {@link AccumulatedState} and
 * {@link DisplayContribution} (in this directory) and the agent entry types
 * in `@feature-forge/tui`'s `types` re-export all key off this single union.
 */
export type AgentViewerEntryStatus = "started" | "running" | "done" | "error" | "cancelled";

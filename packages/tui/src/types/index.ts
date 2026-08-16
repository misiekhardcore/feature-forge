import type { CancelledAgentEntry } from "./CancelledAgentEntry";
import type { CompletedAgentEntry } from "./CompletedAgentEntry";
import type { ErroredAgentEntry } from "./ErroredAgentEntry";
import type { RunningAgentEntry } from "./RunningAgentEntry";

export type { AgentEntryBase } from "./AgentEntryBase";
export type { CancelledAgentEntry } from "./CancelledAgentEntry";
export type { CompletedAgentEntry } from "./CompletedAgentEntry";
export type { ErroredAgentEntry } from "./ErroredAgentEntry";
export type { RunningAgentEntry } from "./RunningAgentEntry";

/**
 * Lifecycle statuses an agent entry can take in the viewer.
 */
export type AgentViewerEntryStatus = "started" | "running" | "done" | "error" | "cancelled";

/**
 * Discriminated union of all possible agent entry states.
 *
 * Use the `status` field to discriminate between:
 * - `status: "started" | "running"` → {@link RunningAgentEntry}
 * - `status: "done"` → {@link CompletedAgentEntry}
 * - `status: "error"` → {@link ErroredAgentEntry}
 * - `status: "cancelled"` → {@link CancelledAgentEntry}
 */
export type AgentViewerEntry =
  | RunningAgentEntry
  | CompletedAgentEntry
  | ErroredAgentEntry
  | CancelledAgentEntry;

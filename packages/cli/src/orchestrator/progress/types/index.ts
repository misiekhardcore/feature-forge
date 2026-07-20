import type { CompletedAgentEntry } from "./CompletedAgentEntry";
import type { ErroredAgentEntry } from "./ErroredAgentEntry";
import type { RunningAgentEntry } from "./RunningAgentEntry";

export type { AgentEntryBase } from "./AgentEntryBase";
export type { CompletedAgentEntry } from "./CompletedAgentEntry";
export type { ErroredAgentEntry } from "./ErroredAgentEntry";
export type { RunningAgentEntry } from "./RunningAgentEntry";

/**
 * Discriminated union of all possible agent entry states.
 *
 * Use the `status` field to discriminate between:
 * - `status: "started"` → {@link RunningAgentEntry}
 * - `status: "done"` → {@link CompletedAgentEntry}
 * - `status: "error"` → {@link ErroredAgentEntry}
 */
export type AgentViewerEntry = RunningAgentEntry | CompletedAgentEntry | ErroredAgentEntry;

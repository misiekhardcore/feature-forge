import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@feature-forge/shared";

import type { AgentViewerEntry } from "./types";

/** Provides read access to agent entries for list/detail views and overlay. */
export interface AgentEntryProvider {
  getAgentEntry(id: string): AgentViewerEntry | undefined;
  getAgentEntries(): ReadonlyMap<string, AgentViewerEntry>;
  getAgentIds(): string[];
  get entryCount(): number;
}

/** Provides streaming line access for list view and overlay. */
export interface AgentStreamProvider {
  getLastLine(agentId: string): string | undefined;
  get lastStreamLine(): string;
}

/** Provides conversation data for detail view. */
export interface AgentConversationProvider {
  getConversationMessages(agentId: string): AgentMessage[];
  loadConversationEvents(agentId: string, count?: number): Promise<AgentEvent[]>;
}

/** Allows overlay to write state updates. */
export interface AgentStateWriter {
  update(entry: AgentViewerEntry): void;
  pushStreamEvent(agentId: string, event: AgentEvent, formatEvent: (e: AgentEvent) => string): void;
  setStreamDir(dir: string): void;
  dispose(): void;
}

/** Query interface for wireOverlayEvents — satisfied by AgentSupervisor. */
export interface AgentQuery {
  getAgent(
    id: string,
  ): { specification: { role: string }; status: string; createdAt: Date } | undefined;
  getAllAgents(): ReadonlyArray<{
    id: string;
    specification: { role: string };
    status: string;
    createdAt: Date;
  }>;
}

/** Event subscription — satisfied by TypedEventBus. */
export interface EventSubscriber {
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

/** Display configuration — satisfied by ForgeConfig. */
export interface DisplayConfig {
  getDisplayMaxAgentEvents(): number;
  getDisplayMaxPreconnectBuffer(): number;
  getDisplayMaxOverlayHeight(): string;
}

/** Tool lookup — satisfied by ToolRegistry (extends Registry<Tool>). */
export interface ToolFormatter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(name: string): Tool<any, any, any> | undefined;
}

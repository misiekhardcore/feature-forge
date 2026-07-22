import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

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
  getAllAgents(): Array<{
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

/** Tool description lookup — satisfied by ToolRegistry. */
export interface ToolFormatter {
  getDescription(name: string): string | undefined;
}

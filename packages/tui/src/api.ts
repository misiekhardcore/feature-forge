import type { AgentEvent, AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentStatus, Tool } from "@feature-forge/shared";

import type { AgentViewerEntry } from "./types";

/** Provides read access to agent entries for list/detail views and overlay. */
export interface AgentEntryProvider {
  getAgentEntry(id: string): AgentViewerEntry | undefined;
  getAgentEntries(): ReadonlyMap<string, AgentViewerEntry>;
  getAgentIds(): string[];
  get entryCount(): number;
  getVersion(): number;
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

/** Family discriminator: `"subprocess"` (RPC transport) or `"in-session"` (live-session persona). */
export type AgentKind = "subprocess" | "in-session";

/** Query interface for wireOverlayEvents — satisfied by AgentSupervisor. */
export interface AgentQuery {
  getAgent(id: string):
    | {
        kind: AgentKind;
        specification: { role: string; model?: string; thinkingLevel?: ThinkingLevel };
        status: AgentStatus;
        createdAt: Date;
      }
    | undefined;
  getAllAgents(): ReadonlyArray<{
    id: string;
    kind: AgentKind;
    specification: { role: string; model?: string; thinkingLevel?: ThinkingLevel };
    status: AgentStatus;
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
  /**
   * Whether pi's thinking blocks should be collapsed to the "Thinking..."
   * label instead of rendering the full reasoning text.
   *
   * Re-read on every render — pi exposes no settings-change event, so the
   * Ctrl+T toggle takes effect on the next re-render. Optional while the
   * toggle is not wired up: consumers may omit it (thinking stays visible).
   */
  getHideThinkingBlock?(): boolean;
}

/** Tool lookup — satisfied by ToolRegistry (extends Registry<Tool>). */
export interface ToolFormatter {
  get(name: string): Tool | undefined;
}

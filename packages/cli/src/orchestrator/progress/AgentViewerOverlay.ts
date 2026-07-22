import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";
import type { AgentViewerEntry } from "@feature-forge/tui";
import { AgentDisplayHelpers } from "@feature-forge/tui";
import { AgentViewerState } from "@feature-forge/tui";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { ForgeConfig } from "../../config";
import { ToolRegistry } from "../../registry/ToolRegistry";
import type { TypedEventBus } from "../eventBus";
import { AgentDetailView } from "./AgentDetailView";
import { AgentListView } from "./AgentListView";

/**
 * View mode for the overlay.
 *
 * - `"list"`: shows all agent entries and their statuses.
 * - `"detail"`: shows detailed information for a single selected agent.
 */
export type ViewMode = "list" | "detail";

/**
 * Maximum events kept in memory per agent (sliding window FIFO).
 * Older events are evicted but persist on disk via JSONL for lazy loading.
 */
function getDisplayMaxAgentEvents(): number {
  return ForgeConfig.getInstance().getDisplayMaxAgentEvents();
}

/**
 * Maximum events buffered before {@link connect} is called.
 * Prevents unbounded memory from a burst of pre-connect events.
 */
function getDisplayMaxPreconnectBuffer(): number {
  return ForgeConfig.getInstance().getDisplayMaxPreconnectBuffer();
}

/**
 * Maximum characters of raw agent output to display per entry.
 */

/**
 * Parameters for constructing an {@link AgentViewerOverlay}.
 */
export interface AgentViewerOverlayParams {
  /** TUI instance used to request re-renders. */
  tui: TUI;
  /** Theme for colouring UI elements. */
  theme: Theme;
  /** Callback invoked when the user presses Escape in list view. */
  onDone: () => void;

  /** Markdown theme for rendering markdown content. */
  markdownTheme: MarkdownTheme;
  /** Current working directory — used by {@link ConversationRenderer} for tool execution display. */
  cwd: string;
  /** Registry for resolving tool definitions to restore argument formatting. */
  toolRegistry: ToolRegistry;
}

/**
 * Standard overlay configuration shared by
 * {@link import("../RoutineTool").RoutineTool} and
 * {@link import("../../commands/AgentListCommand").AgentListCommand}.
 */
const OVERLAY_OPTIONS = {
  anchor: "center" as const,
  width: "100%" as const,
  maxHeight: "85%" as const,
  margin: 1,
};

/**
 * TUI component that renders agent execution details in an overlay widget.
 *
 * Implements the {@link Component} interface for direct use with
 * {@code ctx.ui.custom} overlay APIs.
 *
 * The owning tool (typically {@link import("../RoutineTool").RoutineTool})
 * calls {@link update} as agent events arrive, {@link pushStreamEvent} to
 * forward streaming content, and {@link dispose} when the routine finishes.
 *
 * Architecture note: State is delegated to {@link AgentViewerState},
 * list rendering to {@link AgentListView} (SelectList + BorderedContainer),
 * and detail rendering to {@link AgentDetailView} (ScrollableBox + BorderedContainer).
 * Static methods for event wiring and formatting remain on this class.
 */
export class AgentViewerOverlay implements Component {
  // ── State and views ──────────────────────────────────────

  /** State management delegated to AgentViewerState. */
  private readonly state = new AgentViewerState();

  /** TUI instance for requesting re-renders. */
  private readonly tui: TUI;

  /** Theme for colouring UI elements. */
  private readonly theme: Theme;

  /** Called when the user presses Escape in list view. */
  private readonly onDone: () => void;

  /** Markdown theme — passed through to detail view. */
  private readonly markdownTheme: MarkdownTheme;

  /** Current working directory — passed through to detail view. */
  private readonly cwd: string;

  /** View classes. */
  private readonly listView: AgentListView;
  private readonly detailView: AgentDetailView;

  /** Current view mode. */
  viewMode: ViewMode = "list";

  /**
   * @param params — Configuration object with tui, theme, onDone, markdownTheme, and cwd.
   */
  constructor(params: AgentViewerOverlayParams) {
    this.tui = params.tui;
    this.theme = params.theme;
    this.onDone = params.onDone;
    this.markdownTheme = params.markdownTheme;
    this.cwd = params.cwd;

    this.listView = new AgentListView(
      this.state,
      params.theme,
      params.tui,
      (agentId) => this.openDetail(agentId),
      () => this.onDone(),
    );

    this.detailView = new AgentDetailView(
      this.state,
      params.theme,
      params.markdownTheme,
      params.tui,
      params.cwd,
      params.toolRegistry,
    );
  }

  // ── Properties delegating to views ───────────────────────

  get selectedIndex(): number {
    return this.listView.selectedIndex;
  }

  set selectedIndex(v: number) {
    this.listView.selectedIndex = v;
  }

  get selectedAgentId(): string | undefined {
    return this.detailView.selectedAgentId;
  }

  set selectedAgentId(v: string | undefined) {
    this.detailView.selectedAgentId = v;
  }

  get scrollOffset(): number {
    return this.detailView.scrollOffset;
  }

  set scrollOffset(v: number) {
    this.detailView.scrollOffset = v;
  }

  get autoScroll(): boolean {
    return this.detailView.autoScroll;
  }

  set autoScroll(v: boolean) {
    this.detailView.autoScroll = v;
  }

  // ── Component interface ───────────────────────────────────

  render(width: number): string[] {
    if (this.viewMode === "detail" && this.detailView.selectedAgentId) {
      return this.detailView.render(width);
    }
    return this.listView.render(width);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.viewMode === "detail") {
        this.viewMode = "list";
        this.detailView.selectedAgentId = undefined;
        this.detailView.scrollOffset = 0;
        this.detailView.autoScroll = false;
        this.tui.requestRender();
        return;
      }
      this.onDone();
      return;
    }

    if (this.viewMode === "detail") {
      this.detailView.handleInput(data);
      return;
    }

    this.listView.handleInput(data);
  }

  invalidate(): void {
    /* Stateless render — no cached state to clear. */
  }

  // ── Public data methods ───────────────────────────────────

  /**
   * Configure the stream file directory.
   *
   * When set, every {@link pushStreamEvent} call persists the formatted
   * event line to an append-only log file named
   * `{agentId}.stream` under the given directory.
   *
   * @param streamDir — Directory for filesystem-backed stream buffers.
   */
  setStreamDir(streamDir: string): void {
    this.state.setStreamDir(streamDir);
  }

  /**
   * Standard overlay configuration consumed by
   * {@link import("../RoutineTool").RoutineTool} and
   * {@link import("../../commands/AgentListCommand").AgentListCommand}.
   *
   * Returns a fresh copy so callers can mutate without affecting shared state.
   */
  static get overlayOptions(): typeof OVERLAY_OPTIONS {
    const configHeight = ForgeConfig.getInstance().getDisplayMaxOverlayHeight();
    if (configHeight === "85%") return { ...OVERLAY_OPTIONS };
    return { ...OVERLAY_OPTIONS, maxHeight: configHeight as "85%" };
  }

  /**
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the overlay always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    this.state.update(entry);
    this.tui.requestRender();
  }

  /**
   * Remove all in-memory agent entries and reset view state.
   *
   * Does NOT clean up filesystem stream files — use {@link dispose}
   * for full cleanup when stream file persistence was configured via
   * {@link setStreamDir}.
   */
  clearMemory(): void {
    this.state.clearMemory();
    this.viewMode = "list";
    this.listView.selectedIndex = 0;
    this.detailView.selectedAgentId = undefined;
    this.detailView.scrollOffset = 0;
    this.detailView.autoScroll = false;
  }

  /** Number of agent entries currently tracked. */
  get entryCount(): number {
    return this.state.entryCount;
  }

  /**
   * Push a streaming event for an agent.
   *
   * Formats the event into a human-readable line (kept in memory as the
   * most recent stream line) and, when {@link streamDir} is
   * configured, appends it to a per-agent log file on disk.
   */
  pushStreamEvent(agentId: string, event: AgentEvent): void {
    this.state.pushStreamEvent(agentId, event, (e) => AgentViewerOverlay.formatStreamEvent(e));
    this.detailView.markDirty();
    this.detailView.onStreamEvent(agentId);

    // Auto-scroll to the bottom when in detail view with autoScroll enabled.
    if (
      this.detailView.autoScroll &&
      this.viewMode === "detail" &&
      this.detailView.selectedAgentId === agentId
    ) {
      this.detailView.scrollOffset = Number.MAX_SAFE_INTEGER;
    }

    this.tui.requestRender();
  }

  /**
   * Return the raw stream events for an agent, in insertion order.
   *
   * Only returns events currently held in the in-memory sliding window
   * (up to {@link getDisplayMaxAgentEvents} per agent). Use
   * {@link loadConversationEvents} for disk-backed history beyond the
   * window.
   */
  getConversation(agentId: string): AgentEvent[] {
    return this.state.getConversation(agentId);
  }

  /**
   * Return the cached {@link AgentMessage} objects for an agent, in order.
   *
   * Messages are populated live from {@link pushStreamEvent} on each
   * {@code message_end} event, and loaded from {@code messages.jsonl} at
   * startup by {@link prepopulateStreamFiles}.
   *
   * @param agentId — The agent to get messages for.
   * @returns An array of messages, most recent last. Empty array for unknown agents.
   */
  getConversationMessages(agentId: string): AgentMessage[] {
    return this.state.getConversationMessages(agentId);
  }

  /**
   * Load conversation events from the on-disk JSONL file for the given agent.
   *
   * Streams the file line-by-line via {@code createReadStream} +
   * {@code createInterface}, keeping a ring buffer of the last {@code count}
   * lines in memory.
   *
   * @param agentId — The agent to load events for.
   * @param count — Maximum number of events to return.
   * @returns A promise that resolves to an array of events, most recent last.
   */
  async loadConversationEvents(
    agentId: string,
    count: number = getDisplayMaxAgentEvents(),
  ): Promise<AgentEvent[]> {
    return this.state.loadConversationEvents(agentId, count);
  }

  /**
   * Return the most recent formatted stream line for an agent.
   */
  getLastStreamLine(agentId: string): string | undefined {
    return this.state.getLastLine(agentId);
  }

  /**
   * Return the most recently recorded stream line across all agents.
   */
  get lastStreamLine(): string {
    return this.state.lastStreamLine;
  }

  /**
   * Scan the stream directory for existing per-agent files and pre-populate
   * the overlay's state.
   */
  async prepopulateStreamFiles(streamDir: string): Promise<void> {
    this.state.setStreamDir(streamDir);
    await this.state.prepopulateStreamFiles(streamDir);
  }

  /**
   * Clean up stream files written to disk and reset view state.
   */
  dispose(): void {
    this.state.dispose();
    this.clearMemory();
  }

  // ── Static helpers ────────────────────────────────────────

  /**
   * Map an {@link AgentStatus} enum value to a display status string
   * used by the overlay.
   */
  static mapStatus(status: AgentStatus): string {
    switch (status) {
      case AgentStatus.Spawned:
      case AgentStatus.Running:
        return "started";
      case AgentStatus.Completed:
        return "done";
      case AgentStatus.Failed:
      case AgentStatus.Cancelled:
        return "error";
      default:
        return "unknown";
    }
  }

  static formatElapsed(createdAt: Date): string {
    const ms = Date.now() - createdAt.getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  /**
   * Format a stream event into a single-line human-readable description.
   */
  static formatStreamEvent(event: AgentEvent): string {
    const detail = AgentViewerOverlay.formatDetail(event);
    return detail ? `${event.type}: ${detail}` : event.type;
  }

  // ── Event wiring ──────────────────────────────────────────

  /**
   * Create event subscriptions that feed an overlay with live agent data.
   *
   * Returns subscriptions and a {@code connect} callback.  Callers construct the
   * overlay after subscriptions are established and then call {@code connect}
   * to replay buffered events, set the stream directory, and populate initial
   * agent entries from the supervisor.
   */
  static wireOverlayEvents(params: { eventBus: TypedEventBus; supervisor: AgentSupervisor }): {
    connect: (viewer: AgentViewerOverlay, streamDir: string) => void;
    unsubs: Array<() => void>;
  } {
    const { eventBus, supervisor } = params;

    const eventBuffer: Array<{
      agentId: string;
      event?: AgentEvent;
      status?: string;
      passed?: boolean;
      summary?: string;
    }> = [];

    const capEventBuffer = (): void => {
      const maxPreconnectBuffer = getDisplayMaxPreconnectBuffer();
      if (eventBuffer.length > maxPreconnectBuffer) {
        eventBuffer.splice(0, eventBuffer.length - maxPreconnectBuffer);
      }
    };

    let connected = false;

    const deliverStatusEvent = (
      viewer: AgentViewerOverlay,
      agentId: string,
      mappedStatus: string,
      passed?: boolean,
      eventSummary?: string,
    ) => {
      const agent = supervisor.getAgent(agentId);
      let summary = eventSummary;
      if (!summary && agent) {
        summary =
          passed === false
            ? `${agent.specification.role} — failed`
            : `${agent.specification.role} — ${agent.status}`;
      } else if (!summary) {
        summary = "Agent disconnected";
      }
      viewer.update({
        id: agentId,
        status: mappedStatus as AgentViewerEntry["status"],
        passed,
        summary,
        role: agent?.specification.role,
        createdAt: agent?.createdAt ?? new Date(),
      } as AgentViewerEntry);
    };

    const unsubs = [
      eventBus.on("feature-forge:agent-stream", (payload) => {
        const agentId = payload.details.agentId;
        if (!agentId) return;

        if (payload.details.event) {
          if (connected) {
            viewer.pushStreamEvent(agentId, payload.details.event);
          } else {
            eventBuffer.push({ agentId, event: payload.details.event });
            capEventBuffer();
          }
        }
      }),

      eventBus.on("feature-forge:agent-started", (payload) => {
        const agentId = payload.details.agentId;
        if (!agentId) return;

        const mappedStatus = AgentViewerOverlay.mapStatus(
          supervisor.getAgent(agentId)?.status ?? AgentStatus.Spawned,
        );
        if (connected) {
          deliverStatusEvent(viewer, agentId, mappedStatus);
        } else {
          eventBuffer.push({ agentId, status: mappedStatus });
          capEventBuffer();
        }
      }),

      eventBus.on("feature-forge:agent-done", (payload) => {
        const agentId = payload.details.agentId;
        if (!agentId) return;

        const mappedStatus = AgentViewerOverlay.mapStatus(
          supervisor.getAgent(agentId)?.status ?? AgentStatus.Spawned,
        );
        const passed = payload.details.passed;
        const eventSummary = payload.details.summary;
        if (connected) {
          deliverStatusEvent(viewer, agentId, mappedStatus, passed, eventSummary);
        } else {
          eventBuffer.push({ agentId, status: mappedStatus, passed, summary: eventSummary });
          capEventBuffer();
        }
      }),
    ];

    let viewer!: AgentViewerOverlay;

    const connect = (v: AgentViewerOverlay, streamDir: string) => {
      viewer = v;
      connected = true;
      viewer.setStreamDir(streamDir);

      for (const item of eventBuffer) {
        if (item.status) {
          deliverStatusEvent(viewer, item.agentId, item.status, item.passed, item.summary);
        } else if (item.event) {
          viewer.pushStreamEvent(item.agentId, item.event);
        }
      }
      eventBuffer.length = 0;

      // Fire-and-forget: disk loading happens in background, test-relevant
      // agent population runs synchronously below.
      viewer.prepopulateStreamFiles(streamDir).catch(() => {});

      for (const agent of supervisor.getAllAgents()) {
        const status = AgentViewerOverlay.mapStatus(agent.status);
        viewer.update({
          id: agent.id,
          status: status as AgentViewerEntry["status"],
          summary: `${agent.specification.role} — ${agent.status}`,
          role: agent.specification.role,
          createdAt: agent.createdAt,
        } as AgentViewerEntry);
      }
    };

    return { connect, unsubs };
  }

  // ── Private helpers ───────────────────────────────────────

  private openDetail(agentId: string): void {
    this.viewMode = "detail";
    this.detailView.selectedAgentId = agentId;
    this.detailView.autoScroll = true;
    this.detailView.scrollOffset = Number.MAX_SAFE_INTEGER;
    this.tui.requestRender();
  }

  /**
   * Format a detail string from an event object using the pre-extracted
   * {@code eventType} for type-safe dispatch.
   */
  private static formatDetail(event: AgentEvent): string {
    switch (event.type) {
      case "agent_start":
        return "started";
      case "agent_end":
        return "completed";
      case "turn_start":
        return "turn start";
      case "turn_end":
        return "turn end";

      case "message_start":
        return event.message?.role ?? "";

      case "message_update":
      case "message_end": {
        return event.message ? AgentDisplayHelpers.extractMessageText(event.message) : "";
      }

      case "tool_execution_start": {
        const toolName = event.toolName;
        if ("args" in event && event.args !== undefined) {
          const serialized = AgentDisplayHelpers.serializeToolArgs(event.args);
          return toolName + " | " + serialized;
        }
        return toolName;
      }

      case "tool_execution_end": {
        const name = event.toolName;
        const status = event.isError ? " (error)" : " (ok)";
        return name + status;
      }

      case "tool_execution_update": {
        const name = event.toolName;
        const partial: string =
          typeof event.partialResult === "string"
            ? event.partialResult
            : typeof event.partialResult === "object" && event.partialResult !== null
              ? JSON.stringify(event.partialResult)
              : "";
        return name + ": " + partial;
      }

      default:
        return "";
    }
  }
}

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AgentStatus, jsonParse } from "@feature-forge/shared";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { logger } from "../../logging";
import { ToolRegistry } from "../../registry/ToolRegistry";
import type { TypedEventBus } from "../eventBus";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { ConversationRenderer } from "./ConversationRenderer";

/**
 * Per-agent view entry managed by {@link AgentViewerOverlay}.
 *
 * Updated in place as agent lifecycle events arrive from the executor.
 */
export interface AgentViewerEntry {
  /** Agent instruction id (e.g. "builder", "reviewer"). */
  id: string;
  /** Lifecycle status: "started" | "done" | "error". */
  status: string;
  /** Optional one-line summary from a completed agent step. */
  summary?: string;
  /** Optional raw output from the agent (truncated for display). */
  raw?: string;
  /** Optional display role (e.g. "builder", "reviewer"). */
  role?: string;
  /** Optional elapsed time string (e.g. "2m 14s"). */
  elapsed?: string;
  /** Whether the agent's parsed result passed (undefined when not available). */
  passed?: boolean;
}

/**
 * View mode for the overlay.
 *
 * - `"list"`: shows all agent entries and their statuses.
 * - `"detail"`: shows detailed information for a single selected agent.
 */
export type ViewMode = "list" | "detail";

/**
 * Maximum raw events kept in memory per agent (sliding window FIFO).
 * Older events are evicted but persist on disk via JSONL for lazy loading.
 */
const MAX_AGENT_EVENTS = 200;

/**
 * Maximum events buffered before {@link connect} is called.
 * Prevents unbounded memory from a burst of pre-connect events.
 */
const MAX_PRECONNECT_BUFFER = 2000;

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
 */
export class AgentViewerOverlay implements Component {
  /** Maps agent id → agent entry. */
  private agents = new Map<string, AgentViewerEntry>();

  /** Maps agent id → most recent formatted stream line. */
  private lastLines = new Map<string, string>();

  /** Maps agent id → stream file path on disk. */
  private streamFiles = new Map<string, string>();

  /** Maps agent id → events JSONL file path on disk (raw events, diagnostics only). */
  private eventsFiles = new Map<string, string>();

  /** Maps agent id → messages JSONL file path on disk (finalized messages). */
  private messagesFiles = new Map<string, string>();

  /** TUI instance for requesting re-renders. */
  private readonly tui: TUI;

  /** Theme for colouring UI elements. */
  private readonly theme: Theme;

  /** Called when the user presses Escape in list view. */
  private readonly onDone: () => void;

  /**
   * Theme used when rendering markdown blocks within the conversation
   * view — headings, code blocks, lists (passed through to
   * {@link ConversationRenderer}).
   */
  private readonly markdownTheme: MarkdownTheme;

  /** Current working directory — passed through to {@link ConversationRenderer}. */
  private readonly cwd: string;

  /** Directory used for filesystem-backed stream buffers. */
  private streamDir?: string;

  /** Current view mode. */
  viewMode: ViewMode = "list";

  /** Index of the currently selected agent in the agent list. */
  selectedIndex = 0;

  /** Agent id of the agent shown in detail view. */
  selectedAgentId?: string;

  /** Scroll offset for detail view content. */
  scrollOffset = 0;

  /**
   * Whether the detail view automatically scrolls to the bottom when new
   * stream events arrive. Enabled on entering detail view; disabled by
   * manual scroll-up; re-enabled by scrolling to the very bottom.
   */
  autoScroll = false;

  /** Last render width used to compute scroll bounds. */
  private lastRenderWidth = 80;

  /** Maps agent id → raw stream events in insertion order. */
  private agentEvents = new Map<string, AgentEvent[]>();

  /** Maps agent id → extracted AgentMessage objects in order. */
  private agentMessages = new Map<string, AgentMessage[]>();

  /** Cached line count of the last renderConversationTurns call. Invalidated by pushStreamEvent. */
  private cachedConversationLineCount = 0;

  /** Whether the conversation line count cache needs to be recomputed. */
  private conversationLinesDirty = true;

  /** Stateless conversation renderer — holds only injected dependencies. */
  private readonly conversationRenderer: ConversationRenderer;

  /**
   * @param params — Configuration object with tui, theme, onDone, markdownTheme, and cwd.
   */
  constructor(params: AgentViewerOverlayParams) {
    this.tui = params.tui;
    this.theme = params.theme;
    this.onDone = params.onDone;
    this.markdownTheme = params.markdownTheme;
    this.cwd = params.cwd;
    this.conversationRenderer = new ConversationRenderer({
      theme: params.theme,
      markdownTheme: params.markdownTheme,
      tui: params.tui,
      cwd: params.cwd,
      toolRegistry: params.toolRegistry,
    });
  }

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
    this.streamDir = streamDir;
  }

  /**
   * Standard overlay configuration consumed by
   * {@link import("../RoutineTool").RoutineTool} and
   * {@link import("../../commands/AgentListCommand").AgentListCommand}.
   *
   * Returns a fresh copy so callers can mutate without affecting shared state.
   */
  static get overlayOptions() {
    return { ...OVERLAY_OPTIONS };
  }

  // ── Component interface ───────────────────────────────────

  render(width: number): string[] {
    this.lastRenderWidth = width;
    if (this.viewMode === "detail" && this.selectedAgentId) {
      return this.renderDetail(width);
    }
    return this.renderList(width);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.viewMode === "detail") {
        this.viewMode = "list";
        this.selectedAgentId = undefined;
        this.scrollOffset = 0;
        this.autoScroll = false;
        this.tui.requestRender();
        return;
      }
      this.onDone();
      return;
    }

    if (this.viewMode === "detail") {
      this.handleDetailInput(data);
      return;
    }

    this.handleListInput(data);
  }

  invalidate(): void {
    /* Stateless render — no cached state to clear. */
  }

  // ── Public data methods ───────────────────────────────────

  /**
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the overlay always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    const existing = this.agents.get(entry.id);
    this.agents.set(entry.id, { ...existing, ...entry });
    this.tui.requestRender();
  }

  /**
   * Remove all in-memory agent entries and reset view state.
   *
   * Does NOT clean up filesystem stream files — use {@link dispose}
   * for full cleanup when stream file persistence was configured via
   * {@link setStreamDir}.
   *
   * @remarks Conversations are intentionally NOT cleared —
   * use {@link dispose} for a full reset of all state Maps.
   */
  clearMemory(): void {
    this.agents.clear();
    this.viewMode = "list";
    this.selectedIndex = 0;
    this.selectedAgentId = undefined;
    this.scrollOffset = 0;
    this.autoScroll = false;
  }

  /** Number of agent entries currently tracked. */
  get entryCount(): number {
    return this.agents.size;
  }

  /**
   * Push a streaming event for an agent.
   *
   * Formats the event into a human-readable line (kept in memory as the
   * most recent stream line) and, when {@link streamDir} is
   * configured, appends it to a per-agent log file on disk.
   */
  pushStreamEvent(agentId: string, event: AgentEvent): void {
    if (!this.agents.has(agentId)) {
      this.update({ id: agentId, status: "started" });
    }

    const line = AgentViewerOverlay.formatStreamEvent(event);
    this.lastLines.set(agentId, line);

    if (this.streamDir) {
      try {
        mkdirSync(this.streamDir, { recursive: true });

        // Persist formatted line to .stream file (sync, small writes).
        if (AgentViewerOverlay.shouldPersistToStreamFile(event, line)) {
          const streamPath =
            this.streamFiles.get(agentId) ?? join(this.streamDir, `${agentId}.stream`);
          if (!this.streamFiles.has(agentId)) {
            this.streamFiles.set(agentId, streamPath);
          }
          appendFileSync(streamPath, `${line}\n`, "utf-8");
        }

        // Persist raw event to .events.jsonl (sync, small writes).
        // Raw events are kept for diagnostics only and are never loaded
        // back at startup (see prepopulateStreamFiles).
        const eventsPath =
          this.eventsFiles.get(agentId) ?? join(this.streamDir, `${agentId}.events.jsonl`);
        if (!this.eventsFiles.has(agentId)) {
          this.eventsFiles.set(agentId, eventsPath);
        }
        appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf-8");

        // Persist finalized message to .messages.jsonl (sync, small writes).
        // Only message_end events for user/assistant/toolResult carry a
        // finalized message — this mirrors pi's appendMessage which writes
        // one entry per finalized message, never per streaming update.
        if (event.type === "message_end" && event.message) {
          const message = event.message;
          const role = message.role;
          if (role === "user" || role === "assistant" || role === "toolResult") {
            const messagesPath =
              this.messagesFiles.get(agentId) ?? join(this.streamDir, `${agentId}.messages.jsonl`);
            if (!this.messagesFiles.has(agentId)) {
              this.messagesFiles.set(agentId, messagesPath);
            }
            appendFileSync(messagesPath, `${JSON.stringify(message)}\n`, "utf-8");
          }
        }
      } catch (error) {
        logger.debug("Failed to persist stream event to disk", {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Append the raw event to the in-memory buffer (capped FIFO sliding window).
    const events = this.agentEvents.get(agentId) ?? [];
    events.push(event);
    if (events.length > MAX_AGENT_EVENTS) {
      const removeCount = events.length - MAX_AGENT_EVENTS;
      events.splice(0, removeCount);
    }
    this.agentEvents.set(agentId, events);

    // Extract AgentMessage from the event and update the messages list.
    this.appendMessageFromEvent(agentId, event);

    // Invalidate cached line count so computeScrollMax re-renders.
    this.conversationLinesDirty = true;

    // Auto-scroll to the bottom when in detail view with autoScroll enabled.
    if (this.autoScroll && this.viewMode === "detail" && this.selectedAgentId === agentId) {
      this.scrollOffset = this.computeScrollMax();
    }

    this.tui.requestRender();
  }

  /**
   * Return the raw stream events for an agent, in insertion order.
   *
   * Only returns events currently held in the in-memory sliding window
   * (up to {@link MAX_AGENT_EVENTS} per agent). Use
   * {@link loadConversationEvents} for disk-backed history beyond the
   * window.
   */
  getConversation(agentId: string): AgentEvent[] {
    return this.agentEvents.get(agentId) ?? [];
  }

  /**
   * Return the cached {@link AgentMessage} objects for an agent, in order.
   *
   * Messages are populated live from {@link pushStreamEvent} on each
   * {@code message_end} event, and loaded from {@code messages.jsonl} at
   * startup by {@link prepopulateStreamFiles}. No per-render extraction is
   * performed — this returns the in-memory cache directly.
   *
   * @param agentId — The agent to get messages for.
   * @returns An array of messages, most recent last. Empty array for unknown agents.
   */
  getConversationMessages(agentId: string): AgentMessage[] {
    return this.agentMessages.get(agentId) ?? [];
  }

  /**
   * Load conversation events from the on-disk JSONL file for the given agent.
   *
   * The in-memory buffer holds the most recent {@link MAX_AGENT_EVENTS} events.
   * When {@code count} exceeds the in-memory window, this method loads the
   * oldest needed events from disk and appends the in-memory tail, avoiding
   * loading the entire file into memory.
   *
   * Falls back to the in-memory buffer when the JSONL file is missing or
   * unreadable.
   *
   * @param agentId — The agent to load events for.
   * @param count — Maximum number of events to return (default: 200).
   * @returns A promise that resolves to an array of events, most recent last.
   */
  async loadConversationEvents(
    agentId: string,
    count: number = MAX_AGENT_EVENTS,
  ): Promise<AgentEvent[]> {
    const memoryEvents = this.agentEvents.get(agentId) ?? [];

    // If count fits entirely within the in-memory window, no disk access needed.
    if (count <= memoryEvents.length) {
      return memoryEvents.slice(-count);
    }

    const eventsPath = this.eventsFiles.get(agentId);
    if (!eventsPath) {
      return memoryEvents.slice(-count);
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(eventsPath, "utf-8");
      const lines = content.trimEnd().split("\n");

      // The in-memory buffer is a suffix of the full JSONL log (the most recent
      // MAX_AGENT_EVENTS events). Only load the events OLDER than the in-memory
      // window from disk, then append the in-memory suffix.
      const olderCount = count - memoryEvents.length;
      const olderAvailable = lines.length - memoryEvents.length;
      const fromIndex = Math.max(0, olderAvailable - olderCount);
      const olderSlice = lines.slice(fromIndex, Math.max(0, olderAvailable));

      const diskEvents: AgentEvent[] = [];
      for (const line of olderSlice) {
        try {
          const parsed = jsonParse<AgentEvent>(line);
          diskEvents.push(parsed);
        } catch (error) {
          logger.debug("Skipping malformed event JSONL line", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return [...diskEvents, ...memoryEvents];
    } catch (error) {
      logger.debug(
        "Failed to load conversation events from disk, falling back to in-memory buffer",
        {
          agentId,
          count,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return memoryEvents.slice(-count);
    }
  }

  /**
   * Return the most recent formatted stream line for an agent.
   */
  getLastStreamLine(agentId: string): string | undefined {
    return this.lastLines.get(agentId);
  }

  /**
   * Return the most recently recorded stream line across all agents.
   *
   * Relies on ES6 {@link Map} insertion order — the last value in
   * iteration is the most recently pushed stream event across all agents.
   */
  get lastStreamLine(): string {
    const values = Array.from(this.lastLines.values());
    return values.length > 0 ? values[values.length - 1] : "";
  }

  /**
   * Suffix length helpers for slicing agent ids from per-agent file names.
   */
  private static readonly STREAM_SUFFIX_LEN = ".stream".length;
  private static readonly EVENTS_SUFFIX_LEN = ".events.jsonl".length;
  private static readonly MESSAGES_SUFFIX_LEN = ".messages.jsonl".length;

  /**
   * Scan the stream directory for existing per-agent files and pre-populate
   * the overlay's state.
   *
   * Three file kinds are recognised:
   * - {@code *.stream} — formatted display log (diagnostics). The path is
   *   registered but the file is never replayed.
   * - {@code *.messages.jsonl} — finalized messages (pi's appendMessage
   *   semantics). Loaded into {@link agentMessages}, capped to
   *   {@link MAX_AGENT_EVENTS}, keeping the most recent messages.
   * - {@code *.events.jsonl} — raw events (diagnostics). The path is
   *   registered for lazy {@link loadConversationEvents} access but the
   *   file is NOT loaded into memory at startup.
   *
   * Also creates stale "done" entries for any agents that have files but
   * are not tracked by {@link agents}, so {@code /agent:list} shows the
   * same set of agents as the routine's auto-opened overlay.
   *
   * Silently ignores missing or inaccessible directories — the maps will
   * be populated lazily by {@link pushStreamEvent} calls instead.
   */
  prepopulateStreamFiles(streamDir: string): void {
    try {
      for (const entry of readdirSync(streamDir)) {
        if (entry.endsWith(".stream")) {
          const agentId = entry.slice(0, -AgentViewerOverlay.STREAM_SUFFIX_LEN);
          this.streamFiles.set(agentId, join(streamDir, entry));
          if (!this.agents.has(agentId)) {
            this.update({ id: agentId, status: "done", summary: "Agent completed" });
          }
          continue;
        }

        if (entry.endsWith(".messages.jsonl")) {
          const agentId = entry.slice(0, -AgentViewerOverlay.MESSAGES_SUFFIX_LEN);
          const filePath = join(streamDir, entry);
          this.messagesFiles.set(agentId, filePath);
          if (!this.agents.has(agentId)) {
            this.update({ id: agentId, status: "done", summary: "Agent completed" });
          }
          this.loadMessagesFromDiskIntoCache(agentId, filePath);
          continue;
        }

        if (entry.endsWith(".events.jsonl")) {
          const agentId = entry.slice(0, -AgentViewerOverlay.EVENTS_SUFFIX_LEN);
          const filePath = join(streamDir, entry);
          this.eventsFiles.set(agentId, filePath);
          if (!this.agents.has(agentId)) {
            this.update({ id: agentId, status: "done", summary: "Agent completed" });
          }
          // Raw events are NOT loaded at startup — they remain available
          // for lazy loadConversationEvents access only.
          continue;
        }
      }
    } catch (error) {
      logger.debug("Failed to scan stream directory for prepopulation", {
        streamDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Parse a {@code .messages.jsonl} file into cached {@link agentMessages}.
   *
   * Each line is a serialized {@link AgentMessage}. Messages are merged with
   * any already-cached entries (disk messages first/older, in-memory entries
   * last/newer) and capped to {@link MAX_AGENT_EVENTS} keeping the most
   * recent. Malformed lines are skipped.
   */
  private loadMessagesFromDiskIntoCache(agentId: string, filePath: string): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.trimEnd().split("\n");
      const disk: AgentMessage[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          const parsed = jsonParse<AgentMessage>(line);
          disk.push(parsed);
        } catch (error) {
          logger.debug("Skipping malformed message JSONL line", {
            agentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (disk.length === 0) return;
      const existing = this.agentMessages.get(agentId) ?? [];
      // Disk messages are older (written first); in-memory entries are newer
      // (from live pushStreamEvent calls during this session).
      const merged = [...disk, ...existing];
      if (merged.length > MAX_AGENT_EVENTS) {
        merged.splice(0, merged.length - MAX_AGENT_EVENTS);
      }
      this.agentMessages.set(agentId, merged);
    } catch (error) {
      logger.debug("Failed to prepopulate messages from JSONL file, skipping", {
        agentId,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clean up stream files written to disk and reset view state.
   *
   * Removes each per-agent stream file when {@link streamDir} was
   * configured. Idempotent — safe to call multiple times.
   */
  dispose(): void {
    // Stream files are shared across overlay instances — do NOT delete
    // them here.  The shared temp dir is cleaned up on session exit.
    this.streamFiles.clear();
    this.eventsFiles.clear();
    this.messagesFiles.clear();
    this.lastLines.clear();
    this.agentEvents.clear();
    this.agentMessages.clear();
    this.clearMemory();
  }

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
   * Extract an AgentMessage from an event if it carries one.
   *
   * Returns the message for message\_start, message\_update, and
   * message\_end events. turn\_end carries a duplicate of the preceding
   * message\_end message plus toolResults that also arrive as their own
   * message\_start/message\_end pairs, so it is intentionally ignored
   * here to avoid duplicate entries.
   *
   * Returns undefined for all other event types.
   */
  static extractMessageFromEvent(event: AgentEvent): AgentMessage | undefined {
    switch (event.type) {
      case "message_start":
      case "message_update":
      case "message_end":
        return event.message;
      default:
        return undefined;
    }
  }

  /**
   * Merge an extracted AgentMessage into a message list, handling deduplication
   * for message_update and message_end events by replacing the last entry
   * (the entry pushed by the matching message_start).
   *
   * Used by {@link appendMessageFromEvent} to keep dedup logic in one place.
   */
  private static mergeMessageIntoList(
    messages: AgentMessage[],
    event: AgentEvent,
    message: AgentMessage,
  ): void {
    if (event.type === "message_update" || event.type === "message_end") {
      if (messages.length > 0) {
        messages[messages.length - 1] = message;
      } else {
        messages.push(message);
      }
    } else {
      messages.push(message);
    }
  }

  /**
   * Extract and append an AgentMessage from a raw event to the in-memory cache,
   * handling message updates by replacing the most recent entry.
   *
   * Only message_start, message_update, and message_end carry messages;
   * per-tool toolResult messages arrive as their own message_start/message_end
   * pairs (matching pi's {@code emitToolResultMessage}), so turn_end needs no
   * special handling here — its message and toolResults are duplicates.
   *
   * Applies the same FIFO sliding window cap as agentEvents
   * (MAX_AGENT_EVENTS) to prevent unbounded memory growth.
   */
  private appendMessageFromEvent(agentId: string, event: AgentEvent): void {
    const message = AgentViewerOverlay.extractMessageFromEvent(event);
    if (!message) return;

    const messages = this.agentMessages.get(agentId) ?? [];

    AgentViewerOverlay.mergeMessageIntoList(messages, event, message);

    // Apply FIFO sliding window cap to keep agentMessages in sync
    // with agentEvents bounds.
    if (messages.length > MAX_AGENT_EVENTS) {
      messages.splice(0, messages.length - MAX_AGENT_EVENTS);
    }

    this.agentMessages.set(agentId, messages);
  }

  // ── Static helpers ────────────────────────────────────────

  /**
   * Format a stream event into a single-line human-readable description.
   *
   * Dispatches based on {@code event.type} to {@link formatDetail}.
   * Returns empty string for non-object payloads.
   */
  static formatStreamEvent(event: AgentEvent): string {
    const detail = AgentViewerOverlay.formatDetail(event);
    return detail ? `${event.type}: ${detail}` : event.type;
  }

  /**
   * Whether an event should be persisted to the on-disk {@code .stream} file.
   *
   * Excludes noisy incremental events (message_update) and lifecycle markers
   * (turn_start, turn_end) whose content arrives through other events.
   * Also excludes message_end events that produced no extracted text.
   */
  private static shouldPersistToStreamFile(event: AgentEvent, line: string): boolean {
    switch (event.type) {
      case "message_update":
      case "turn_start":
      case "turn_end":
        return false;
      case "message_end":
        return line !== "message_end";
      default:
        return true;
    }
  }

  // ── Private rendering ─────────────────────────────────────

  /** Compute available overlay content height in rows.
   *
   * Mirrors the TUI's resolveOverlayLayout logic for maxHeight=95%, margin=1.
   * Subtracts 4 for border decorations (top + bottom + 2 margin lines inside border)
   * to return the height available for actual content lines.
   * Falls back to a reasonable default (20 rows) when terminal dimensions are
   * unavailable (e.g., in tests).
   */
  private computeViewportHeight(): number {
    const termHeight = this.tui?.terminal?.rows;
    if (!termHeight || termHeight < 1) return 15;
    const rawMaxHeight = Math.ceil(
      this.percentToNumber(AgentViewerOverlay.overlayOptions.maxHeight) * termHeight,
    );
    const maxHeight = Math.max(1, rawMaxHeight);
    // Subtract 5 for addBorder wrapper: top border, top margin, bottom margin, bottom border.
    return Math.max(1, maxHeight - 5);
  }

  private percentToNumber(percent: `${number}%`) {
    return Number(percent.slice(0, -1)) / 100;
  }

  private addBorder(lines: string[], outerWidth: number): string[] {
    const { theme } = this;
    // Content width inside the border after subtracting 2 for the `|` border
    // chars on each side, and 2 for the single-space margins inside each border.
    const contentWidth = Math.max(0, outerWidth - 4);

    const top = theme.fg(
      "warning",
      "┌" + AgentDisplayHelpers.getHorizontalLine(contentWidth + 2) + "┐",
    );
    const bot = theme.fg(
      "warning",
      "└" + AgentDisplayHelpers.getHorizontalLine(contentWidth + 2) + "┘",
    );
    const leftBorder = theme.fg("warning", "│");
    const rightBorder = theme.fg("warning", "│");

    const result: string[] = [];

    // Top border
    result.push(top);

    // Top blank margin (1 line inside border)
    result.push(leftBorder + " ".repeat(contentWidth + 2) + rightBorder);

    for (const raw of lines) {
      // Normalize every line to exactly contentWidth visible chars using
      // pi-tui's truncateToWidth which handles ANSI/OSC sequences correctly.
      // Empty-string ellipsis avoids appending "..." on truncation;
      // pad=true ensures short lines are space-padded to contentWidth.
      const normalized = truncateToWidth(raw, contentWidth, "", true);
      result.push(leftBorder + " " + normalized + " " + rightBorder);
    }

    // Bottom blank margin (1 line inside border)
    result.push(leftBorder + " ".repeat(contentWidth + 2) + rightBorder);

    // Bottom border
    result.push(bot);

    return result;
  }

  private renderList(width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "Agent Viewer"));
    lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(width)));

    if (this.agents.size === 0) {
      lines.push(theme.fg("muted", "no agents running"));
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
      return this.addBorder(wrapped, width);
    }

    const entries = Array.from(this.agents.entries());
    for (let index = 0; index < entries.length; index++) {
      const [id, entry] = entries[index];
      const isSelected = index === this.selectedIndex;
      const { char: icon, color: iconColor } = AgentDisplayHelpers.getStatusIcon(
        entry.status,
        entry.passed,
      );

      const cursor = isSelected ? "▶" : " ";
      const idStyled = isSelected ? theme.fg("accent", id) : id;
      const roleSuffix = entry.role ? theme.fg("muted", `(${entry.role})`) : "";
      const elapsedSuffix = entry.elapsed ? theme.fg("muted", entry.elapsed) : "";
      lines.push(
        `${cursor} ${theme.fg(iconColor, icon)} ${idStyled} ${roleSuffix} ${elapsedSuffix}`,
      );

      const maxWidth = 3 * width;
      // Show last stream line for started agents (truncated to fit width).
      const lastLine = this.lastLines.get(id);
      if (lastLine) {
        lines.push(theme.fg("muted", this.trimListViewText(lastLine, maxWidth)));
      }

      if (entry.summary) {
        lines.push(theme.fg("muted", this.trimListViewText(entry.summary, maxWidth)));
      }

      if (entry.raw !== undefined) {
        for (const rawLine of entry.raw.split("\n")) {
          lines.push(theme.fg("muted", rawLine));
        }
      }
    }

    // Help text
    lines.push("");
    lines.push(
      theme.fg(
        "muted",
        `${theme.fg("accent", "↑↓")} navigate  ${theme.fg("accent", "Enter")} view  ${theme.fg("accent", "Esc")} close`,
      ),
    );

    const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
    return this.addBorder(wrapped, width);
  }

  private trimListViewText(text: string, maxWidth: number) {
    if (text.length <= maxWidth) return text;
    return text.substring(0, maxWidth - 3) + "...";
  }

  private renderDetail(width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    const entry = this.selectedAgentId ? this.agents.get(this.selectedAgentId) : undefined;
    if (!entry) {
      lines.push(theme.fg("accent", "Agent Detail"));
      lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(width - 4)));
      lines.push(theme.fg("muted", "agent not found"));
      lines.push("");
      lines.push(theme.fg("muted", `${theme.fg("accent", "Esc")} back`));
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
      return this.addBorder(wrapped, width);
    }

    const { char: icon, color: iconColor } = AgentDisplayHelpers.getStatusIcon(
      entry.status,
      entry.passed,
    );
    const { label, color: statusColor } = AgentDisplayHelpers.getStatusLabel(
      entry.status,
      entry.passed,
    );

    // Header
    lines.push(
      `${theme.fg(iconColor, icon)} ${theme.fg("accent", entry.id)} — ${theme.fg(statusColor, label)}`,
    );
    lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(width - 4)));

    // Summary
    if (entry.summary) {
      lines.push(theme.fg("accent", "Summary:"));
      lines.push("");
      lines.push(entry.summary);
      lines.push("");
    }

    // Conversation header
    lines.push(theme.fg("accent", "Conversation:"));
    lines.push("");

    const messages = this.getConversationMessages(entry.id);
    const conversationLines = this.renderConversationTurns(messages, width);
    if (conversationLines.length === 0) {
      lines.push(theme.fg("muted", "No conversation recorded."));
      lines.push("");
    } else {
      for (const convLine of conversationLines) {
        lines.push(convLine);
      }
      lines.push("");
    }

    // Help text
    lines.push(
      theme.fg("muted", `${theme.fg("accent", "Esc")} back  ${theme.fg("accent", "↑↓")} scroll`),
    );

    // Compute viewport window and clamp scroll offset.
    const viewportHeight = this.computeViewportHeight();
    const maxOffset = Math.max(0, lines.length - viewportHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
    const viewportEnd = Math.min(this.scrollOffset + viewportHeight, lines.length);
    const visibleLines = lines.slice(this.scrollOffset, viewportEnd);

    const wrapped = visibleLines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
    return this.addBorder(wrapped, width);
  }

  // ── Private conversation rendering ───────────────────────
  /**
   * Render a list of messages as styled conversation lines.
   *
   * Delegates to {@link ConversationRenderer} which dispatches by role.
   */
  private renderConversationTurns(messages: AgentMessage[], width: number): string[] {
    return this.conversationRenderer.render(messages, width - 4);
  }

  private handleListInput(data: string): void {
    const entries = Array.from(this.agents.keys());

    if (matchesKey(data, Key.up)) {
      if (entries.length === 0) return;
      this.selectedIndex = this.selectedIndex > 0 ? this.selectedIndex - 1 : entries.length - 1;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down)) {
      if (entries.length === 0) return;
      this.selectedIndex = this.selectedIndex < entries.length - 1 ? this.selectedIndex + 1 : 0;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.enter)) {
      if (entries.length === 0) return;
      const agentId = entries[this.selectedIndex];
      if (agentId) {
        this.viewMode = "detail";
        this.selectedAgentId = agentId;
        this.autoScroll = true;
        this.scrollOffset = 0;
        this.tui.requestRender();
      }
    }
  }

  private handleDetailInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.autoScroll = false;
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down)) {
      const maxOffset = this.computeScrollMax();
      this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset);
      // Resume auto-scroll when the user scrolled to the very bottom.
      if (this.scrollOffset >= maxOffset) {
        this.autoScroll = true;
      }
      this.tui.requestRender();
    }
  }

  /**
   * Compute the maximum valid scroll offset based on the current detail
   * view line count so that {@link scrollOffset} never grows unbounded.
   */
  private computeScrollMax(): number {
    if (!this.selectedAgentId) return 0;
    const entry = this.agents.get(this.selectedAgentId);
    if (!entry) return 0;

    // Replicate the line structure of renderDetail without full rendering
    // to compute the maximum valid scroll offset.
    // Base header: agent line + separator = 2
    const baseHeaderLines = 2;
    // Summary section: "Summary:" + content + empty line = 3
    const summaryLines = entry.summary ? 4 : 0;
    // Conversation block: "Conversation:" header + turn lines + trailing empty line.
    // Use cached line count unless pushStreamEvent dirtied it.
    if (this.conversationLinesDirty) {
      this.cachedConversationLineCount = this.renderConversationTurns(
        this.getConversationMessages(this.selectedAgentId),
        this.lastRenderWidth,
      ).length;
      this.conversationLinesDirty = false;
    }
    const totalConversationBlock = 2 + this.cachedConversationLineCount + 1;
    // Help text: 1
    const footerLines = 1;

    const totalLines = baseHeaderLines + summaryLines + totalConversationBlock + footerLines;
    const viewportHeight = this.computeViewportHeight();
    return Math.max(0, totalLines - viewportHeight);
  }

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
      if (eventBuffer.length > MAX_PRECONNECT_BUFFER) {
        eventBuffer.splice(0, eventBuffer.length - MAX_PRECONNECT_BUFFER);
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
      const summary =
        eventSummary ??
        (agent ? `${agent.specification.role} — ${agent.status}` : "Agent disconnected");
      viewer.update({
        id: agentId,
        status: mappedStatus,
        passed,
        summary,
        role: agent?.specification.role,
        elapsed: agent ? AgentViewerOverlay.formatElapsed(agent.createdAt) : undefined,
      });
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

      for (const item of eventBuffer) {
        if (item.status) {
          deliverStatusEvent(viewer, item.agentId, item.status, item.passed, item.summary);
        } else if (item.event) {
          viewer.pushStreamEvent(item.agentId, item.event);
        }
      }
      eventBuffer.length = 0;

      viewer.setStreamDir(streamDir);

      viewer.prepopulateStreamFiles(streamDir);

      for (const agent of supervisor.getAllAgents()) {
        const status = AgentViewerOverlay.mapStatus(agent.status);
        viewer.update({
          id: agent.id,
          status,
          summary: `${agent.specification.role} — ${agent.status}`,
          role: agent.specification.role,
          elapsed: AgentViewerOverlay.formatElapsed(agent.createdAt),
        });
      }
    };

    return { connect, unsubs };
  }

  /**
   * Format a detail string from an event object using the pre-extracted
   * {@code eventType} for type-safe dispatch.
   *
   * Accepts a generic record so that callers do not need unsafe
   * {@code as AgentEvent} casts. All property access is guarded.
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
        // Serialize args into the stream line so they survive the
        // .stream file round-trip (replayed via parseStreamLine).
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

import { appendFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { EventBus, Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type { Component, MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { AgentDisplayHelpers } from "./helpers";

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
 * Maximum characters of raw agent output to display per entry.
 */
const DEFAULT_MAX_RAW_LENGTH = 500;

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
  /** Current working directory from the extension context. */
  cwd: string;
  /** Markdown theme for rendering markdown content. */
  markdownTheme: MarkdownTheme;
}

/**
 * Standard overlay configuration shared by
 * {@link import("../RoutineTool").RoutineTool} and
 * {@link import("../../commands/AgentListCommand").AgentListCommand}.
 */
const OVERLAY_OPTIONS = {
  anchor: "center" as const,
  width: "100%" as const,
  maxHeight: "95%" as const,
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

  /** TUI instance for requesting re-renders. */
  private readonly tui: TUI;

  /** Theme for colouring UI elements. */
  private readonly theme: Theme;

  /** Called when the user presses Escape in list view. */
  private readonly onDone: () => void;

  /**
   * Reserved for Phase 3 — base directory for resolving relative paths
   * when rendering markdown content or accessing workspace files.
   */
  private readonly cwd: string;

  /**
   * Reserved for Phase 3 — theme used when rendering markdown blocks
   * within the conversation view, e.g. headings, code blocks, lists.
   * Currently stored but not wired into rendering methods.
   */
  private readonly markdownTheme: MarkdownTheme;

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

  /**
   * @param params — Configuration object with tui, theme, onDone, cwd, and markdownTheme.
   */
  constructor(params: AgentViewerOverlayParams) {
    this.tui = params.tui;
    this.theme = params.theme;
    this.onDone = params.onDone;
    this.cwd = params.cwd;
    this.markdownTheme = params.markdownTheme;
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

    // Skip noisy events from the stream file:
    // - message_update: tiny incremental deltas; full text arrives as message_end
    // - turn_start / turn_end: lifecycle noise with no actionable content
    // - message_end with no extracted text: nothing to show
    const shouldWrite =
      event.type !== "message_update" &&
      event.type !== "turn_start" &&
      event.type !== "turn_end" &&
      !(event.type === "message_end" && line === "message_end");
    if (this.streamDir && shouldWrite) {
      try {
        mkdirSync(this.streamDir, { recursive: true });
        const filePath = this.streamFiles.get(agentId) ?? join(this.streamDir, `${agentId}.stream`);
        if (!this.streamFiles.has(agentId)) {
          this.streamFiles.set(agentId, filePath);
        }
        appendFileSync(filePath, `${line}\n`, "utf-8");
      } catch {
        // Silently ignore filesystem errors — the in-memory line is sufficient.
      }
    }

    // Append the raw event to the in-memory buffer.
    const events = this.agentEvents.get(agentId) ?? [];
    events.push(event);
    this.agentEvents.set(agentId, events);

    // Auto-scroll to the bottom when in detail view with autoScroll enabled.
    if (this.autoScroll && this.viewMode === "detail" && this.selectedAgentId === agentId) {
      this.scrollOffset = this.computeScrollMax();
    }

    this.tui.requestRender();
  }

  /**
   * Return the raw stream events for an agent, in insertion order.
   */
  getConversation(agentId: string): AgentEvent[] {
    return this.agentEvents.get(agentId) ?? [];
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
   * Scan the stream directory for existing {@code *.stream} files and
   * pre-populate the internal {@link streamFiles} map.
   *
   * Also creates stale "done" entries for any agents that have stream
   * files but are not tracked by {@link agents}. This ensures that
   * {@code /agent:list} shows the same set of agents as the routine's
   * auto-opened overlay, even after completed agents have been removed
   * from the supervisor.
   *
   * Silently ignores missing or inaccessible directories — the map
   * will be populated lazily by {@link pushStreamEvent} calls instead.
   */
  prepopulateStreamFiles(streamDir: string): void {
    try {
      for (const entry of readdirSync(streamDir)) {
        if (entry.endsWith(".stream")) {
          const agentId = entry.slice(0, -7);
          const filePath = join(streamDir, entry);
          this.streamFiles.set(agentId, filePath);
          // Restore entries for agents that completed and were removed
          // from the supervisor so /agent:list shows the same set as
          // the routine's auto-opened overlay.
          if (!this.agents.has(agentId)) {
            this.update({ id: agentId, status: "done", summary: "Agent completed" });
          }
          // No replay is needed — events are ingested in real time
          // via pushStreamEvent. The stream file serves as an append-only
          // log for debugging, not as a re-ingestion source.
        }
      }
    } catch {
      // Directory may not exist or be inaccessible.
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
    this.lastLines.clear();
    this.agentEvents.clear();
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

  // ── Static helpers ────────────────────────────────────────

  /**
   * Format a stream event into a single-line human-readable description.
   *
   * Accepts any object payload and dispatches based on {@code event.type}
   * to {@link formatDetail}, which handles {@code Record<string, unknown>}
   * payloads with guarded property access. Falls back to JSON
   * serialization for non-object payloads.
   */
  static formatStreamEvent(event: unknown): string {
    if (event !== null && typeof event === "object" && "type" in event) {
      const typed = event as Record<string, unknown>;
      const rawType = typed["type"];
      const eventType = typeof rawType === "string" ? rawType : "unknown";
      const detail = AgentViewerOverlay.formatDetail(typed, eventType);
      return detail ? `${eventType}: ${detail}` : eventType;
    }
    const serialized = JSON.stringify(event);
    return serialized.length > 120 ? serialized.slice(0, 117) + "..." : serialized;
  }

  // ── Private rendering ─────────────────────────────────────

  private addBorder(lines: string[], contentWidth: number): string[] {
    const { theme } = this;
    const inner = Math.max(contentWidth - 2, 10);

    const top = theme.fg("warning", "┌" + "─".repeat(inner) + "┐");
    const bot = theme.fg("warning", "└" + "─".repeat(inner) + "┘");
    const leftBorder = theme.fg("warning", "│");
    const rightBorder = theme.fg("warning", "│");

    // Content area between left and right margin spaces.
    const contentArea = Math.max(inner - 2, 0);

    const result: string[] = [];

    // Top border
    result.push(top);

    // 1-line top margin (blank line with borders + margin spaces)
    result.push(leftBorder + " " + " ".repeat(contentArea) + " " + rightBorder);

    for (const raw of lines) {
      const visible = this.stripAnsi(raw);
      const pad = visible.length < contentArea ? " ".repeat(contentArea - visible.length) : "";
      result.push(leftBorder + " " + raw + pad + " " + rightBorder);
    }

    // 1-line bottom margin (blank line with borders + margin spaces)
    result.push(leftBorder + " " + " ".repeat(contentArea) + " " + rightBorder);

    // Bottom border
    result.push(bot);

    return result;
  }

  private renderList(width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "⟳ Agent Viewer"));
    const separatorWidth = Math.min(width, 60);
    lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

    if (this.agents.size === 0) {
      lines.push(`  ${theme.fg("muted", "no agents running")}`);
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
      const roleSuffix = entry.role ? ` ${theme.fg("muted", `(${entry.role})`)}` : "";
      const elapsedSuffix = entry.elapsed ? ` ${theme.fg("muted", entry.elapsed)}` : "";
      lines.push(`${cursor} ${theme.fg(iconColor, icon)} ${idStyled}${roleSuffix}${elapsedSuffix}`);

      // Show last stream line for started agents (truncated to fit width).
      const lastLine = this.lastLines.get(id);
      if (lastLine) {
        const maxLastLineWidth = Math.max(10, width - 4);
        const truncatedLastLine =
          lastLine.length > maxLastLineWidth
            ? lastLine.slice(0, maxLastLineWidth - 3) + "..."
            : lastLine;
        lines.push(`    ${theme.fg("muted", truncatedLastLine)}`);
      }

      if (entry.summary) {
        lines.push(`    ${theme.fg("muted", entry.summary)}`);
      }

      if (entry.raw !== undefined) {
        const truncated =
          entry.raw.length > DEFAULT_MAX_RAW_LENGTH
            ? entry.raw.slice(0, DEFAULT_MAX_RAW_LENGTH) + "..."
            : entry.raw;
        for (const rawLine of truncated.split("\n")) {
          lines.push(`      ${theme.fg("muted", rawLine)}`);
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

  private renderDetail(width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    const entry = this.selectedAgentId ? this.agents.get(this.selectedAgentId) : undefined;
    if (!entry) {
      lines.push(theme.fg("accent", "⟳ Agent Detail"));
      lines.push(theme.fg("muted", "─".repeat(Math.min(width, 60))));
      lines.push(`  ${theme.fg("muted", "agent not found")}`);
      lines.push("");
      lines.push(theme.fg("muted", `${theme.fg("accent", "Esc")} back`));
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
      return this.addBorder(wrapped, width);
    }

    const { char: icon } = AgentDisplayHelpers.getStatusIcon(entry.status, entry.passed);

    // Header
    let statusLabel: string;
    switch (entry.status) {
      case "started":
        statusLabel = "running";
        break;
      case "done":
        statusLabel = entry.passed === false ? "failed" : "completed";
        break;
      default:
        statusLabel = entry.status;
        break;
    }
    lines.push(
      `${theme.fg("accent", "⟳")} ${icon} ${theme.fg("accent", entry.id)}${theme.fg("muted", ` — ${statusLabel}`)}`,
    );
    const separatorWidth = Math.min(width, 60);
    lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

    // Summary
    if (entry.summary) {
      lines.push(theme.fg("accent", "Summary:"));
      lines.push(`  ${entry.summary}`);
      lines.push("");
    }

    // Conversation header
    lines.push(theme.fg("accent", "Conversation:"));

    const events = this.getConversation(entry.id);
    const conversationLines = this.renderConversationTurns(events, width);
    if (conversationLines.length === 0) {
      lines.push(`  ${theme.fg("muted", "No conversation recorded.")}`);
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

    // Clamp scroll offset to visible range and keep state in sync.
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, lines.length - 1)));
    const visibleLines = lines.slice(this.scrollOffset);

    const wrapped = visibleLines.flatMap((line) => wrapTextWithAnsi(line, width - 4));
    return this.addBorder(wrapped, width);
  }

  // ── Private conversation rendering ───────────────────────
  /**
   * Render a list of raw stream events as styled conversation lines.
   *
   * Groups related start/end events (message_start → message_end,
   * tool_execution_start → tool_execution_end) into visual blocks and
   * delegates rendering to pi components: {@link UserMessageComponent},
   * {@link AssistantMessageComponent}, {@link ToolExecutionComponent}.
   */
  private renderConversationTurns(events: AgentEvent[], width: number): string[] {
    const lines: string[] = [];
    let toolCallIndex = 0;

    // In-progress state for grouping start/end event pairs.
    let pendingMessage: { role: string; content: string } | undefined;
    let pendingTool:
      | {
          toolName: string;
          toolArgs?: string;
          toolStatus: "running" | "ok" | "error";
          toolResult: string;
        }
      | undefined;

    const flushMessage = (): void => {
      if (pendingMessage && pendingMessage.content.length > 0) {
        const innerWidth = Math.max(10, width - 4);
        if (pendingMessage.role === "user") {
          const component = new UserMessageComponent(pendingMessage.content, this.markdownTheme);
          const rendered = component.render(innerWidth);
          for (const line of rendered) {
            lines.push(`  ${line}`);
          }
        } else {
          // AssistantMessageComponent only reads content — supply minimal message.
          const assistantMsg = {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: pendingMessage.content }],
          } as AssistantMessage;
          const component = new AssistantMessageComponent(assistantMsg, false, this.markdownTheme);
          const rendered = component.render(innerWidth);
          for (const line of rendered) {
            lines.push(`  ${line}`);
          }
        }
      }
      pendingMessage = undefined;
    };

    const flushTool = (): void => {
      if (pendingTool) {
        toolCallIndex++;
        const innerWidth = Math.max(10, width - 4);
        const component = new ToolExecutionComponent(
          pendingTool.toolName,
          `tool-${toolCallIndex}`,
          pendingTool.toolArgs || {},
          undefined,
          undefined,
          this.tui,
          this.cwd,
        );
        if (pendingTool.toolStatus !== "running") {
          component.updateResult(
            {
              content: [{ type: "text", text: pendingTool.toolResult }],
              isError: pendingTool.toolStatus === "error",
            },
            false,
          );
          component.setExpanded(true);
        }
        const rendered = component.render(innerWidth);
        for (const line of rendered) {
          lines.push(`  ${line}`);
        }
      }
      pendingTool = undefined;
    };

    for (const event of events) {
      if (event.type === "message_start") {
        flushTool();
        const typed = event as Record<string, unknown>;
        const msg =
          typeof typed["message"] === "object" && typed["message"] !== null
            ? (typed["message"] as Record<string, unknown>)
            : undefined;
        const role = typeof msg?.["role"] === "string" ? msg["role"] : "unknown";
        pendingMessage = { role, content: "" };
      } else if (event.type === "message_update" || event.type === "message_end") {
        const typed = event as Record<string, unknown>;
        if (pendingMessage) {
          // Extract latest content from the event's message.
          pendingMessage.content = AgentDisplayHelpers.extractMessageText(typed["message"]);
        }
        if (event.type === "message_end") {
          flushMessage();
        }
      } else if (event.type === "tool_execution_start") {
        flushMessage();
        const typed = event as Record<string, unknown>;
        const toolName = typeof typed["toolName"] === "string" ? typed["toolName"] : "unknown";
        const args =
          "args" in typed && typed["args"] !== undefined
            ? AgentDisplayHelpers.serializeToolArgs(typed["args"])
            : undefined;
        pendingTool = { toolName, toolArgs: args, toolStatus: "running", toolResult: "" };
      } else if (event.type === "tool_execution_update") {
        if (pendingTool) {
          const typed = event as Record<string, unknown>;
          if (typeof typed["partialResult"] === "string") {
            pendingTool.toolResult += typed["partialResult"];
          }
        }
      } else if (event.type === "tool_execution_end") {
        if (pendingTool) {
          const typed = event as Record<string, unknown>;
          pendingTool.toolStatus = typed["isError"] === true ? "error" : "ok";
          if (typeof typed["result"] === "string") {
            pendingTool.toolResult = typed["result"];
          }
        }
        flushTool();
      }
    }

    // Flush any remaining pending state (incomplete start without end).
    flushMessage();
    flushTool();

    return lines;
  }

  /**
   * Strip ANSI escape sequences to measure visible length.
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
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
        this.scrollOffset = this.computeScrollMax();
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
    const summaryLines = entry.summary ? 3 : 0;
    // Conversation block from renderConversation: "Conversation:" header +
    // turn lines + trailing empty line = 1 + conversationLines + 1
    const conversationTurns = this.renderConversationTurns(
      this.getConversation(this.selectedAgentId),
      this.lastRenderWidth,
    ).length;
    const totalConversationBlock = 1 + conversationTurns + 1;
    // Help text: 1
    const footerLines = 1;

    const totalLines = baseHeaderLines + summaryLines + totalConversationBlock + footerLines;
    return Math.max(0, totalLines - 1);
  }

  /**
   * Create event subscriptions that feed an overlay with live agent data.
   *
   * Returns subscriptions and a {@code connect} callback.  Callers construct the
   * overlay after subscriptions are established and then call {@code connect}
   * to replay buffered events, set the stream directory, and populate initial
   * agent entries from the supervisor.
   */
  static wireOverlayEvents(params: { eventBus: EventBus; supervisor: AgentSupervisor }): {
    connect: (viewer: AgentViewerOverlay, streamDir: string) => void;
    unsubs: Array<() => void>;
  } {
    const { eventBus, supervisor } = params;

    const channels = [
      "feature-forge:agent-stream",
      "feature-forge:agent-started",
      "feature-forge:agent-done",
    ] as const;

    const eventBuffer: Array<{
      agentId: string;
      event?: AgentEvent;
      status?: string;
      passed?: boolean;
      summary?: string;
    }> = [];
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

    const unsubs = channels.map((channel) =>
      eventBus.on(channel, (data) => {
        const payload = data as {
          details?: {
            agentId?: string;
            event?: unknown;
            passed?: boolean;
            summary?: string;
          };
        };
        const agentId = payload.details?.agentId;
        if (!agentId) return;

        if (channel === "feature-forge:agent-stream" && payload.details?.event) {
          if (connected) {
            viewer.pushStreamEvent(agentId, payload.details.event as AgentEvent);
          } else {
            eventBuffer.push({
              agentId,
              event: payload.details.event as AgentEvent,
            });
          }
        } else if (
          channel === "feature-forge:agent-started" ||
          channel === "feature-forge:agent-done"
        ) {
          const mappedStatus = AgentViewerOverlay.mapStatus(
            supervisor.getAgent(agentId)?.status ?? AgentStatus.Spawned,
          );
          const passed = payload.details?.passed;
          const eventSummary = payload.details?.summary;
          if (connected) {
            deliverStatusEvent(viewer, agentId, mappedStatus, passed, eventSummary);
          } else {
            eventBuffer.push({
              agentId,
              status: mappedStatus,
              passed,
              summary: eventSummary,
            });
          }
        }
      }),
    );

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
  private static formatDetail(event: Record<string, unknown>, eventType: string): string {
    switch (eventType) {
      case "agent_start":
        return "started";
      case "agent_end":
        return "completed";
      case "turn_start":
        return "turn start";
      case "turn_end":
        return "turn end";

      case "message_start": {
        const role = AgentDisplayHelpers.getNestedString(event, "message", "role");
        return role.slice(0, 80);
      }

      case "message_update":
      case "message_end": {
        const text = AgentDisplayHelpers.extractMessageText(event.message);
        return text.slice(0, 80);
      }

      case "tool_execution_start": {
        const name = event.toolName;
        const toolName = typeof name === "string" ? name.slice(0, 80) : "";
        // Serialize args into the stream line so they survive the
        // .stream file round-trip (replayed via parseStreamLine).
        if ("args" in event && event.args !== undefined) {
          const serialized = AgentDisplayHelpers.serializeToolArgs(event.args);
          return (toolName + " | " + serialized).slice(0, 240);
        }
        return toolName;
      }

      case "tool_execution_end": {
        const name = typeof event.toolName === "string" ? event.toolName : "";
        const status = event.isError ? " (error)" : " (ok)";
        return (name + status).slice(0, 80);
      }

      case "tool_execution_update": {
        const name = typeof event.toolName === "string" ? event.toolName : "";
        const partial: string =
          typeof event.partialResult === "string"
            ? event.partialResult
            : typeof event.partialResult === "object" && event.partialResult !== null
              ? JSON.stringify(event.partialResult)
              : "";
        const truncated = partial.length > 60 ? partial.slice(0, 57) + "..." : partial;
        return (name + ": " + truncated).slice(0, 80);
      }

      default:
        return "";
    }
  }
}

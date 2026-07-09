import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { EventBus, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";

/**
 * A single turn in a per-agent conversation built from stream events.
 *
 * Message turns carry role + text content. Tool-call turns carry the
 * tool name, execution status, and optional result text.
 */
export interface ConversationTurn {
  type: "message" | "tool_call";
  /** Role for message turns (e.g. "assistant", "user"). */
  role?: string;
  /** Text content for message turns. */
  content?: string;
  /** Tool name for tool-call turns. */
  toolName?: string;
  /** Execution status for tool-call turns. */
  toolStatus?: "running" | "ok" | "error";
  /** Optional result text for tool-call turns. */
  toolResult?: string;
}

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

  /** Last render width used to compute scroll bounds. */
  private lastRenderWidth = 80;

  /** Maps agent id → structured conversation turns built from stream events. */
  private conversations = new Map<string, ConversationTurn[]>();

  /**
   * In-progress message turns being built from message_start/update/end
   * events, keyed by agent id so that concurrent agent streams do not
   * interfere with each other.
   */
  private pendingMessages = new Map<string, { role: string; content: string }>();

  /**
   * In-progress tool-call turns being built from tool_execution_* events,
   * keyed by agent id.
   */
  private pendingToolCalls = new Map<
    string,
    { name: string; status: "running" | "ok" | "error"; result: string }
  >();

  /**
   * @param tui — TUI instance used to request re-renders.
   * @param theme — Theme for colouring UI elements.
   * @param onDone — Callback invoked when the user presses Escape in list view.
   */
  constructor(tui: TUI, theme: Theme, onDone: () => void) {
    this.tui = tui;
    this.theme = theme;
    this.onDone = onDone;
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
   * @deprecated Use {@link setStreamDir} — the executionId prefix is no
   * longer part of the file path.
   */
  setAgentExecutionId(_executionId: string, streamDir?: string): void {
    if (streamDir) this.setStreamDir(streamDir);
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
   * {@link setAgentExecutionId}.
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
  }

  /** Number of agent entries currently tracked. */
  get entryCount(): number {
    return this.agents.size;
  }

  /**
   * Push a streaming event for an agent.
   *
   * Formats the event into a human-readable line (kept in memory as the
   * most recent stream line) and, when {@link streamDir} and
   * {@link executionId} are configured, appends it to a per-agent log
   * file on disk.
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

    this.trackConversationTurn(agentId, event);

    this.tui.requestRender();
  }

  /**
   * Return the structured conversation turns for an agent.
   *
   * Includes any in-progress message or tool-call that has not yet been
   * finalized by a subsequent event.
   */
  getConversation(agentId: string): ConversationTurn[] {
    const turns = [...(this.conversations.get(agentId) ?? [])];

    const pendingMessage = this.pendingMessages.get(agentId);
    if (pendingMessage && pendingMessage.content.length > 0) {
      turns.push({
        type: "message" as const,
        role: pendingMessage.role,
        content: pendingMessage.content,
      });
    }

    const pendingToolCall = this.pendingToolCalls.get(agentId);
    if (pendingToolCall) {
      turns.push({
        type: "tool_call" as const,
        toolName: pendingToolCall.name,
        toolStatus: pendingToolCall.status,
        toolResult: pendingToolCall.result,
      });
    }

    return turns;
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
   * Read the tail of a per-agent stream log file from disk.
   *
   * Only available when {@link streamDir} and {@link executionId} were
   * configured via {@link setAgentExecutionId} and at least one
   * {@link pushStreamEvent} call was made for the agent.
   */
  getStreamTail(agentId: string, maxLines = 100): string {
    const filePath = this.streamFiles.get(agentId);
    if (!filePath) return "";
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.length > 0);
      const tail = lines.slice(-maxLines);
      return tail.join("\n");
    } catch {
      return "";
    }
  }

  /**
   * Scan the stream directory for existing {@code *.stream} files and
   * pre-populate the internal {@link streamFiles} map so that
   * {@link getStreamTail} works across overlay instances.
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
    this.conversations.clear();
    this.pendingMessages.clear();
    this.pendingToolCalls.clear();
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

  /**
   * Format a {@link Date} as an elapsed-time string (e.g. "2m 14s").
   */
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
   * Map an agent status to a theme-coloured icon character.
   *
   * - `"done"` → success green ✓
   * - `"started"` → warning yellow ⏳
   * - `"error"` → error red ✗
   * - anything else → muted grey ○
   */
  static statusIcon(status: string, passed?: boolean): string {
    switch (status) {
      case "done":
        return passed === false ? "✗" : "✓";
      case "started":
        return "⏳";
      case "error":
        return "✗";
      default:
        return "○";
    }
  }

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
    const top = theme.fg("border", "┌" + "─".repeat(inner) + "┐");
    const bot = theme.fg("border", "└" + "─".repeat(inner) + "┘");
    const result: string[] = [top];
    for (const raw of lines) {
      const visible = this.stripAnsi(raw);
      const pad = visible.length < inner ? " ".repeat(inner - visible.length) : "";
      result.push(theme.fg("border", "│") + raw + pad + theme.fg("border", "│"));
    }
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
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 2));
      return this.addBorder(wrapped, width);
    }

    const entries = Array.from(this.agents.entries());
    for (let index = 0; index < entries.length; index++) {
      const [id, entry] = entries[index];
      const isSelected = index === this.selectedIndex;
      const icon = AgentViewerOverlay.statusIcon(entry.status, entry.passed);
      let iconColor: ThemeColor;
      switch (entry.status) {
        case "done":
          iconColor = entry.passed !== false ? "success" : "error";
          break;
        case "started":
          iconColor = "warning";
          break;
        case "error":
          iconColor = "error";
          break;
        default:
          iconColor = "muted";
          break;
      }

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

    const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 2));
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
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, width - 2));
      return this.addBorder(wrapped, width);
    }

    const icon = AgentViewerOverlay.statusIcon(entry.status, entry.passed);

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

    // Structured conversation from stream events
    const conversationLines = this.renderConversation(entry.id, width);
    for (const convLine of conversationLines) {
      lines.push(convLine);
    }

    // Help text
    lines.push(
      theme.fg("muted", `${theme.fg("accent", "Esc")} back  ${theme.fg("accent", "↑↓")} scroll`),
    );

    // Clamp scroll offset to visible range and keep state in sync.
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, lines.length - 1)));
    const visibleLines = lines.slice(this.scrollOffset);

    const wrapped = visibleLines.flatMap((line) => wrapTextWithAnsi(line, width - 2));
    return this.addBorder(wrapped, width);
  }

  // ── Private conversation rendering ───────────────────────

  /**
   * Render the structured conversation for an agent as a list of styled lines.
   */
  private renderConversation(agentId: string, width: number): string[] {
    const { theme } = this;
    const turns = this.getConversation(agentId);
    const lines: string[] = [];

    lines.push(theme.fg("accent", "Conversation:"));

    if (turns.length === 0) {
      lines.push(`  ${theme.fg("muted", "No conversation recorded.")}`);
      lines.push("");
      return lines;
    }

    const turnLines = this.renderConversationTurns(turns, width);
    for (const line of turnLines) {
      lines.push(line);
    }

    lines.push("");
    return lines;
  }

  /**
   * Render conversation turn lines without header/footer for scroll-bound
   * calculation.  Called by {@link computeScrollMax} to determine the
   * maximum valid scroll offset.
   */
  private renderConversationContent(agentId: string, width: number): string[] {
    const turns = this.getConversation(agentId);
    if (turns.length === 0) return [];
    return this.renderConversationTurns(turns, width);
  }

  /**
   * Render a list of conversation turns as styled lines.
   *
   * Shared by {@link renderConversation} (which adds header/footer) and
   * {@link renderConversationContent} (which returns the raw turn lines
   * for scroll-bound calculation).
   */
  private renderConversationTurns(turns: ConversationTurn[], width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    for (const turn of turns) {
      if (turn.type === "message") {
        const roleText = turn.role ?? "unknown";
        const roleColor: ThemeColor = roleText === "user" ? "userMessageText" : "accent";
        lines.push(`  ${theme.fg(roleColor, `${roleText}:`)}`);
        if (turn.content) {
          const maxContentWidth = Math.max(10, width - 6);
          const truncated =
            turn.content.length > maxContentWidth
              ? turn.content.slice(0, maxContentWidth - 3) + "..."
              : turn.content;
          for (const contentLine of truncated.split("\n")) {
            if (contentLine.length > 0) {
              const styled = AgentViewerOverlay.applyInlineMarkdown(theme, contentLine);
              lines.push(`    ${styled}`);
            }
          }
        }
      } else {
        const toolLines = this.renderToolCall(turn, width);
        for (const toolLine of toolLines) {
          lines.push(toolLine);
        }
      }
    }

    return lines;
  }

  /**
   * Apply inline markdown styling to a single content line.
   *
   * Detects bold (**text**), italic (*text*), and inline code
   * (\`text\`) patterns and wraps them with the injected theme's
   * bold / italic / inverse styling methods.
   */
  private static applyInlineMarkdown(theme: Theme, line: string): string {
    let result = line;

    // Bold: **text**
    result = result.replace(/\*\*(.+?)\*\*/g, (_match: string, text: string): string =>
      theme.bold(text),
    );
    // Italic: *text* (but not **)
    result = result.replace(
      /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
      (_match: string, text: string): string => theme.italic(text),
    );
    // Inline code: `text`
    result = result.replace(/`(.+?)`/g, (_match: string, text: string): string =>
      theme.inverse(text),
    );

    return result;
  }

  /**
   * Render a single tool-call turn as styled lines with coloured
   * background boxes via {@link Theme.bg}.
   */
  private renderToolCall(turn: ConversationTurn, width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    let statusIcon: string;
    let statusColor: ThemeColor;
    switch (turn.toolStatus) {
      case "ok":
        statusIcon = "✓";
        statusColor = "success";
        break;
      case "error":
        statusIcon = "✗";
        statusColor = "error";
        break;
      default:
        statusIcon = "⏳";
        statusColor = "warning";
        break;
    }

    const toolName = turn.toolName ?? "unknown";
    let statusLabel: string;
    switch (turn.toolStatus) {
      case "running":
        statusLabel = "(running)";
        break;
      case "ok":
        statusLabel = "(ok)";
        break;
      case "error":
        statusLabel = "(error)";
        break;
      default:
        statusLabel = "";
        break;
    }
    const innerWidth = Math.max(10, width - 6);
    const headerLine = `${theme.fg(statusColor, statusIcon)} ${theme.fg("accent", toolName)} ${theme.fg("muted", statusLabel)}`;
    const headerPad = innerWidth - this.stripAnsi(headerLine).length;
    const paddedHeader = headerPad > 0 ? headerLine + " ".repeat(headerPad) : headerLine;

    const bgColor =
      turn.toolStatus === "ok"
        ? "toolSuccessBg"
        : turn.toolStatus === "error"
          ? "toolErrorBg"
          : "toolPendingBg";
    lines.push(`  ${theme.bg(bgColor, paddedHeader)}`);

    if (turn.toolResult) {
      const maxResultWidth = Math.max(10, width - 8);
      const truncated =
        turn.toolResult.length > maxResultWidth
          ? turn.toolResult.slice(0, maxResultWidth - 3) + "..."
          : turn.toolResult;
      for (const resultLine of truncated.split("\n")) {
        lines.push(`      ${theme.fg("toolOutput", resultLine)}`);
      }
    }

    return lines;
  }

  /**
   * Strip ANSI escape sequences to measure visible length.
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  /**
   * Build conversation turns from an incoming stream event.
   *
   * Maintains pending message / tool-call state so that multi-event
   * sequences (e.g. message_start → message_update → message_end) are
   * collapsed into a single turn when finalized.
   */
  private trackConversationTurn(agentId: string, event: AgentEvent): void {
    if (event.type === "message_start") {
      this.finalizePendingTurns(agentId);
      const message =
        event.message && typeof event.message === "object"
          ? (event.message as unknown as Record<string, unknown>)
          : null;
      const rawRole = message ? message["role"] : undefined;
      const role = typeof rawRole === "string" ? rawRole : "unknown";
      this.pendingMessages.set(agentId, { role, content: "" });
    } else if (event.type === "message_update") {
      const text = AgentViewerOverlay.extractMessageText(event.message);
      const pending = this.pendingMessages.get(agentId);
      if (pending) {
        pending.content = text;
      }
    } else if (event.type === "message_end") {
      const text = AgentViewerOverlay.extractMessageText(event.message);
      const pending = this.pendingMessages.get(agentId);
      if (pending) {
        pending.content = text;
      }
      this.finalizePendingTurns(agentId);
    } else if (event.type === "tool_execution_start") {
      this.finalizePendingTurns(agentId);
      const toolName =
        event.toolName && typeof event.toolName === "string" ? event.toolName : "unknown";
      this.pendingToolCalls.set(agentId, { name: toolName, status: "running", result: "" });
    } else if (event.type === "tool_execution_update") {
      // partialResult may be object (serialized via formatDetail) or string;
      // final tool_execution_end replaces accumulated result, so partial
      // non-strings are intentionally skipped here.
      const pending = this.pendingToolCalls.get(agentId);
      if (pending && typeof event.partialResult === "string") {
        pending.result += event.partialResult;
      }
    } else if (event.type === "tool_execution_end") {
      const pending = this.pendingToolCalls.get(agentId);
      if (pending) {
        pending.status = event.isError === true ? "error" : "ok";
        if (typeof event.result === "string") {
          pending.result = event.result;
        }
      }
      this.finalizePendingTurns(agentId);
    }
  }

  /**
   * Commit any in-progress message or tool-call into the agent's conversation.
   */
  private finalizePendingTurns(agentId: string): void {
    const turns = [...(this.conversations.get(agentId) ?? [])];

    const pendingMessage = this.pendingMessages.get(agentId);
    if (pendingMessage && pendingMessage.content.length > 0) {
      turns.push({
        type: "message" as const,
        role: pendingMessage.role,
        content: pendingMessage.content,
      });
      this.pendingMessages.delete(agentId);
    }

    const pendingToolCall = this.pendingToolCalls.get(agentId);
    if (pendingToolCall) {
      turns.push({
        type: "tool_call" as const,
        toolName: pendingToolCall.name,
        toolStatus: pendingToolCall.status,
        toolResult: pendingToolCall.result,
      });
      this.pendingToolCalls.delete(agentId);
    }

    this.conversations.set(agentId, turns);
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
        this.scrollOffset = 0;
        this.tui.requestRender();
      }
    }
  }

  private handleDetailInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down)) {
      const maxOffset = this.computeScrollMax();
      this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset);
      this.tui.requestRender();
    }
  }

  /**
   * Compute the maximum valid scroll offset based on the current detail
   * view line count so that {@link scrollOffset} never grows unbounded.
   */
  private computeScrollMax(): number {
    if (!this.selectedAgentId) return 0;
    // Render detail to get total line count.
    const entry = this.agents.get(this.selectedAgentId);
    if (!entry) return 0;
    const headerLines = 4;
    const footerLines = 1;
    const conversationLines = this.renderConversationContent(
      this.selectedAgentId,
      this.lastRenderWidth,
    ).length;
    const totalLines = headerLines + conversationLines + footerLines;
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

    let viewer: AgentViewerOverlay;

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
        const role = AgentViewerOverlay.getNestedString(event, "message", "role");
        return role.slice(0, 80);
      }

      case "message_update":
      case "message_end": {
        const text = AgentViewerOverlay.extractMessageText(event.message);
        return text.slice(0, 80);
      }

      case "tool_execution_start": {
        const name = event.toolName;
        return typeof name === "string" ? name.slice(0, 80) : "";
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

  /**
   * Walk a dotted key path into a nested object and return a string value,
   * or {@code ""} when any intermediate key is missing.
   */
  private static getNestedString(root: unknown, ...keys: string[]): string {
    let current: unknown = root;
    for (const key of keys) {
      if (typeof current !== "object" || current === null) return "";
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === "string" ? current : "";
  }

  /**
   * Extract concatenated text from a message object"s content blocks.
   *
   * Handles both arrays of {@code { type: "text", text: "..." }} blocks
   * and plain string content.
   */
  private static extractMessageText(message: unknown): string {
    if (typeof message === "string") return message;
    if (typeof message !== "object" || message === null) return "";
    const msg = message as Record<string, unknown>;
    const content = msg["content"];
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const b = block as Record<string, unknown>;
        if (b["type"] === "text" && typeof b["text"] === "string") {
          parts.push(b["text"]);
        }
      }
    }
    return parts.join(" ");
  }
}

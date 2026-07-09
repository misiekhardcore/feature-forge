import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { EventBus, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";

import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";

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

  /** The standard overlay options for this component. */
  static get overlayOptions() {
    return { ...OVERLAY_OPTIONS };
  }

  // ── Component interface ───────────────────────────────────

  render(width: number): string[] {
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

    this.tui.requestRender();
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
    if (!createdAt) return "—";
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
   * Uses the {@link AgentEvent} discriminated union for type-safe
   * detail extraction via {@link extractStreamDetail}. Falls back to
   * JSON serialization for non-AgentEvent payloads.
   */
  static formatStreamEvent(event: unknown): string {
    if (event !== null && typeof event === "object" && "type" in event) {
      const typed = event as Record<string, unknown>;
      const rawType = typed["type"];
      const eventType = typeof rawType === "string" ? rawType : "unknown";
      const detail = AgentViewerOverlay.formatDetail(typed as AgentEvent, eventType);
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
      // Strip ANSI to measure visible length, then pad.
      // eslint-disable-next-line no-control-regex
      const visible = raw.replace(/\[[0-9;]*m/g, "");
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
      const iconColor =
        entry.status === "done" && entry.passed !== false
          ? "success"
          : entry.status === "done"
            ? "error"
            : entry.status === "started"
              ? "warning"
              : entry.status === "error"
                ? "error"
                : "muted";

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
    const statusLabel =
      entry.status === "started"
        ? "running"
        : entry.status === "done" && entry.passed === false
          ? "failed"
          : entry.status === "done"
            ? "completed"
            : entry.status;
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

    // Stream tail from disk when available
    if (this.streamDir && this.selectedAgentId) {
      const tail = this.getStreamTail(this.selectedAgentId, 50);
      if (tail.length > 0) {
        lines.push(theme.fg("accent", "Stream log:"));
        for (const tailLine of tail.split("\n")) {
          lines.push(`  ${theme.fg("muted", tailLine)}`);
        }
        lines.push("");
      } else {
        lines.push(theme.fg("muted", "  No stream events captured."));
        lines.push("");
      }
    }

    // Last stream line (in-memory fallback, truncated to fit width)
    const lastLine = this.lastLines.get(entry.id);
    if (lastLine) {
      const maxLastLineWidth = Math.max(10, width - 2);
      const truncatedLastLine =
        lastLine.length > maxLastLineWidth
          ? lastLine.slice(0, maxLastLineWidth - 3) + "..."
          : lastLine;
      lines.push(theme.fg("accent", "Last event:"));
      lines.push(`  ${theme.fg("muted", truncatedLastLine)}`);
      lines.push("");
    }

    // Raw output
    if (entry.raw !== undefined) {
      lines.push(theme.fg("accent", "Raw output:"));
      const truncated =
        entry.raw.length > DEFAULT_MAX_RAW_LENGTH
          ? entry.raw.slice(0, DEFAULT_MAX_RAW_LENGTH) + "..."
          : entry.raw;
      for (const rawLine of truncated.split("\n")) {
        lines.push(`  ${theme.fg("muted", rawLine)}`);
      }
      lines.push("");
    }

    // Help text
    lines.push(
      theme.fg("muted", `${theme.fg("accent", "Esc")} back  ${theme.fg("accent", "↑↓")} scroll`),
    );

    // Clamp scroll offset to visible range without mutating state.
    const effectiveOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, lines.length - 1)));
    const visibleLines = lines.slice(effectiveOffset);

    const wrapped = visibleLines.flatMap((line) => wrapTextWithAnsi(line, width - 2));
    return this.addBorder(wrapped, width);
  }

  // ── Private input handling ────────────────────────────────

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
      this.scrollOffset = this.scrollOffset + 1;
      this.tui.requestRender();
    }
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

      // Pre-populate streamFiles map from existing *.stream files so
      // getStreamTail works for files written by prior overlay instances.
      try {
        for (const entry of readdirSync(streamDir)) {
          if (entry.endsWith(".stream")) {
            const agentId = entry.slice(0, -7);
            const filePath = join(streamDir, entry);
            viewer.streamFiles.set(agentId, filePath);
          }
        }
      } catch {
        // Directory may not exist or be inaccessible — streamFiles will
        // be populated lazily by pushStreamEvent calls.
      }

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
   * Format a detail string from an {@link AgentEvent} using the
   * discriminated union for type-safe field access.
   *
   * The {@code eventType} parameter is preserved for the fallback path
   * in {@link formatStreamEvent} where the event shape is unknown.
   */
  private static formatDetail(event: AgentEvent, _eventType: string): string {
    // Defensive: `as AgentEvent` casts at runtime may produce object
    // shapes with missing fields. Use guards for all property access.
    switch (event.type) {
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

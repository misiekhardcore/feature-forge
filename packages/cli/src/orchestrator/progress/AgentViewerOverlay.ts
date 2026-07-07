import { appendFileSync, mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

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
}

/**
 * Type guard for an object with a `text` string property, used by
 * {@link AgentViewerOverlay.formatStreamEvent} when extracting a detail
 * from a `tool_result` content array.
 */
function isToolResultTextBlock(value: unknown): value is { text: string } {
  if (typeof value !== "object" || value === null || !("text" in value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate["text"] === "string";
}

/**
 * Maximum characters of raw agent output to display per entry.
 */
const DEFAULT_MAX_RAW_LENGTH = 500;

/**
 * TUI component that renders agent execution details in a widget.
 *
 * Implements the {@link Component} interface for direct use with
 * {@code ctx.ui.setWidget}.
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

  /** Execution-scoped identifier used as a prefix for stream filenames. */
  private executionId?: string;

  /** Directory used for filesystem-backed stream buffers. */
  private streamDir?: string;

  /**
   * @param tui — TUI instance used to request re-renders.
   * @param theme — Theme for colouring UI elements.
   */
  constructor(tui: TUI, theme: Theme) {
    this.tui = tui;
    this.theme = theme;
  }

  /**
   * Configure execution-scoped stream file behaviour.
   *
   * When set, every {@link pushStreamEvent} call persists the formatted
   * event line to an append-only log file named
   * `{executionId}-{agentId}.stream` under the given directory.
   *
   * @param executionId — Unique execution identifier used as a filename prefix.
   * @param streamDir — Directory for filesystem-backed stream buffers.
   */
  setAgentExecutionId(executionId: string, streamDir?: string): void {
    this.executionId = executionId;
    this.streamDir = streamDir;
  }

  // ── Component interface ───────────────────────────────────

  render(width: number): string[] {
    return this.renderList(width);
  }

  handleInput(_data: string): void {
    // Widget is not closable — absorb all input to prevent
    // the TUI global Escape handler from dismissing it during
    // routine execution. The widget is only removed by the
    // owning RoutineTool when the routine completes.
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
   * Remove all in-memory agent entries.
   *
   * Preserves lastLines in-memory; use {@link dispose} for full cleanup
   * including stream files and lastLines when stream file persistence was
   * configured via {@link setAgentExecutionId}.
   */
  clearMemory(): void {
    this.agents.clear();
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
  pushStreamEvent(agentId: string, event: unknown): void {
    const line = AgentViewerOverlay.formatStreamEvent(event);
    this.lastLines.set(agentId, line);

    if (this.streamDir && this.executionId) {
      try {
        mkdirSync(this.streamDir, { recursive: true });
        const filePath =
          this.streamFiles.get(agentId) ??
          join(this.streamDir, `${this.executionId}-${agentId}.stream`);
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
    if (this.streamDir) {
      for (const filePath of this.streamFiles.values()) {
        try {
          unlinkSync(filePath);
        } catch {
          // Silently ignore — file may already be removed.
        }
      }
      // Try to remove the stream directory if empty.
      try {
        rmSync(this.streamDir, { recursive: false, force: true });
      } catch {
        // Silently ignore.
      }
    }
    this.streamFiles.clear();
    this.lastLines.clear();
    this.clearMemory();
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
  static statusIcon(status: string): string {
    switch (status) {
      case "done":
        return "✓";
      case "started":
        return "⏳";
      case "error":
        return "✗";
      default:
        return "○";
    }
  }

  /**
   * Format a raw stream event into a single-line human-readable description.
   *
   * - When the event is an object with a `type` field, formats as `type: value`.
   * - Otherwise serializes the event as JSON and truncates to one line.
   */
  static formatStreamEvent(event: unknown): string {
    if (event !== null && typeof event === "object" && "type" in event) {
      const typed = event as Record<string, unknown>;
      const rawType = typed["type"];
      const eventType = typeof rawType === "string" ? rawType : "unknown";
      const detail = AgentViewerOverlay.extractStreamDetail(eventType, typed);
      return detail ? `${eventType}: ${detail}` : eventType;
    }
    const serialized = JSON.stringify(event);
    return serialized.length > 120 ? serialized.slice(0, 117) + "..." : serialized;
  }

  // ── Private rendering ─────────────────────────────────────

  private renderList(width: number): string[] {
    const { theme } = this;
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "⟳ Agent Viewer"));
    const separatorWidth = Math.min(width, 60);
    lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

    if (this.agents.size === 0) {
      lines.push(`  ${theme.fg("muted", "no agents running")}`);
      return lines.flatMap((line) => wrapTextWithAnsi(line, width));
    }

    const entries = Array.from(this.agents.entries());
    for (const [, [id, entry]] of entries.entries()) {
      const icon = AgentViewerOverlay.statusIcon(entry.status);
      const statusLabel = `[${entry.status}]`;

      lines.push(`  ${icon} ${id} ${theme.fg("muted", statusLabel)}`);

      // Show last stream line for started agents (truncated to fit width).
      const lastLine = this.lastLines.get(id);
      if (lastLine && entry.status === "started") {
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

    return lines.flatMap((line) => wrapTextWithAnsi(line, width));
  }

  /**
   * Extract a short detail string from a known stream event shape.
   */
  private static extractStreamDetail(eventType: string, event: Record<string, unknown>): string {
    switch (eventType) {
      case "tool_use": {
        const tool = event["tool"];
        return typeof tool === "string" ? tool : "";
      }
      case "tool_result": {
        const content = event["content"];
        if (typeof content === "string") return content.slice(0, 80);
        if (Array.isArray(content) && content.length > 0) {
          if (isToolResultTextBlock(content[0])) {
            return content[0].text.slice(0, 80);
          }
        }
        return "";
      }
      case "message_start": {
        const role = event["role"];
        return typeof role === "string" ? role : "";
      }
      case "assistant": {
        const text = event["text"];
        if (typeof text === "string") return text.slice(0, 80);
        return "";
      }
      default:
        return "";
    }
  }
}

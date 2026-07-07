import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
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
 * TUI component that renders agent execution details in an overlay widget.
 *
 * Designed to be rendered via {@code ctx.ui.setWidget} or
 * {@code ctx.ui.custom} as a persistent panel showing live agent status.
 *
 * The owning tool (typically {@link import("../RoutineTool").RoutineTool})
 * calls {@link update} as agent events arrive and {@link clear} when the
 * routine finishes.
 */
export class AgentViewerOverlay {
  private agents = new Map<string, AgentViewerEntry>();

  /** Maps agent id → most recent formatted stream line. */
  private lastLines = new Map<string, string>();

  /** Map of agent id → stream file path on disk. */
  private streamFiles = new Map<string, string>();

  /** Max characters of raw agent output to display per entry. */
  private readonly maxRawLength: number;

  /** Directory used for filesystem-backed stream buffers. */
  private readonly streamDir?: string;

  /**
   * @param maxRawLength — Truncation limit for raw agent output (default 500).
   * @param streamDir — Directory for filesystem-backed stream buffers.
   *   When set, every {@link pushStreamEvent} call persists the formatted
   *   event line to an append-only log file under this directory, keeping
   *   only the most recent line in memory. Omit to keep stream events
   *   memory-only.
   */
  constructor(maxRawLength = 500, streamDir?: string) {
    this.maxRawLength = maxRawLength;
    this.streamDir = streamDir;
  }

  /**
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the overlay always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    const existing = this.agents.get(entry.id);
    this.agents.set(entry.id, { ...existing, ...entry });
  }

  /** Remove all agent entries. */
  clear(): void {
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
   * most recent stream line) and, when {@link streamDir} is configured,
   * appends it to a per-agent log file on disk.
   */
  pushStreamEvent(agentId: string, event: unknown): void {
    const line = AgentViewerOverlay.formatStreamEvent(event);
    this.lastLines.set(agentId, line);

    if (this.streamDir) {
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
  }

  /**
   * Return the most recent formatted stream line for an agent.
   */
  getLastStreamLine(agentId: string): string | undefined {
    return this.lastLines.get(agentId);
  }

  /**
   * Return the most recently recorded stream line across all agents.
   */
  get lastStreamLine(): string {
    const values = Array.from(this.lastLines.values());
    return values.length > 0 ? values[values.length - 1] : "";
  }

  /**
   * Read the tail of a per-agent stream log file from disk.
   *
   * Only available when a {@link streamDir} was configured at construction
   * and at least one {@link pushStreamEvent} call was made for the agent.
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
   * Build a {@link Component} factory suitable for
   * {@code ctx.ui.setWidget(key, factory)}.
   *
   * Returns a function `(tui, theme) => Component` that the TUI calls.
   * The returned Component reads live agent state from this overlay instance
   * so callers can re-render by calling {@code ctx.ui.setWidget} again.
   */
  buildWidgetFactory(): (_tui: TUI, theme: Theme) => Component {
    return (_tui: TUI, theme: Theme): Component => ({
      render: (width: number) => this.renderLines(width, theme),
      invalidate: () => {
        /* stateless — re-render is handled by setWidget calls */
      },
    });
  }

  // ── Static ──────────────────────────────────────────────

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

  // ── Private rendering ────────────────────────────────────

  private renderLines(width: number, theme: Theme): string[] {
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "⟳ Agent Viewer"));
    const separatorWidth = Math.min(width, 60);
    lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

    if (this.agents.size === 0) {
      lines.push(`  ${theme.fg("muted", "no agents running")}`);
      return lines.flatMap((line) => wrapTextWithAnsi(line, width));
    }

    for (const [id, entry] of this.agents) {
      const icon = AgentViewerOverlay.statusIcon(entry.status);
      const statusLabel = `[${entry.status}]`;
      lines.push(`  ${icon} ${id} ${theme.fg("muted", statusLabel)}`);

      // Show last stream line for active agents.
      const lastLine = this.lastLines.get(id);
      if (lastLine && entry.status === "started") {
        lines.push(`    ${theme.fg("muted", lastLine)}`);
      }

      if (entry.summary) {
        lines.push(`    ${theme.fg("muted", entry.summary)}`);
      }

      if (entry.raw !== undefined) {
        const truncated =
          entry.raw.length > this.maxRawLength
            ? entry.raw.slice(0, this.maxRawLength) + "..."
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

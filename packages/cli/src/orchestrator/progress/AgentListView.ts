import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { AgentViewerBase } from "./AgentViewerBase";
import { AgentViewerState } from "./AgentViewerState";

/**
 * Renders the list of agent entries with their statuses.
 *
 * Extends {@link AgentViewerBase} for shared layout constants.
 */
export class AgentListView {
  /** Index of the currently selected agent. */
  selectedIndex = 0;

  private readonly state: AgentViewerState;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly onSelectAgent: (agentId: string) => void;
  private readonly onDone: () => void;

  constructor(
    state: AgentViewerState,
    theme: Theme,
    tui: TUI,
    onSelectAgent: (agentId: string) => void,
    onDone: () => void,
  ) {
    this.state = state;
    this.theme = theme;
    this.tui = tui;
    this.onSelectAgent = onSelectAgent;
    this.onDone = onDone;
  }

  /**
   * Render the agent list with status icons, last stream line previews,
   * and navigation help legend inside a bordered box.
   */
  render(width: number): string[] {
    const { theme } = this;
    const contentW = AgentViewerBase.contentWidth(width);
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "Agent Viewer"));
    lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(contentW)));

    if (this.state.entryCount === 0) {
      lines.push(theme.fg("muted", "no agents running"));
      const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, contentW));
      return AgentViewerBase.addBorder(wrapped, width, this.theme);
    }

    const entries = Array.from(this.state.getAgentEntries().entries());
    for (let index = 0; index < entries.length; index++) {
      const [id, entry] = entries[index];
      const isSelected = index === this.selectedIndex;
      const { char: icon, color: iconColor } = AgentDisplayHelpers.getStatusIcon(
        entry.status,
        entry.passed,
      );

      const cursor = isSelected ? "→" : " ";
      const idStyled = isSelected ? theme.fg("accent", id) : id;
      const roleSuffix = entry.role ? theme.fg("muted", `(${entry.role})`) : "";
      const elapsedSuffix = entry.elapsed ? theme.fg("muted", entry.elapsed) : "";
      lines.push(
        `${cursor} ${theme.fg(iconColor, icon)} ${idStyled} ${roleSuffix} ${elapsedSuffix}`,
      );

      const maxWidth = contentW;
      // Show last stream line for started agents (truncated to fit width).
      const lastLine = this.state.getLastLine(id);
      if (lastLine) {
        lines.push(theme.fg("muted", truncateToWidth(lastLine, maxWidth)));
      }

      if (entry.summary) {
        lines.push(theme.fg("muted", truncateToWidth(entry.summary, maxWidth)));
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

    const wrapped = lines.flatMap((line) => wrapTextWithAnsi(line, contentW));
    return AgentViewerBase.addBorder(wrapped, width, this.theme);
  }

  /**
   * Handle keyboard input for list navigation.
   *
   * Up/Down arrows change selection (with wrapping), Enter selects
   * the highlighted agent to open its detail view, Escape closes.
   */
  handleInput(data: string): void {
    const entries = this.state.getAgentIds();

    if (matchesKey(data, Key.escape)) {
      this.onDone();
      return;
    }

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
        this.onSelectAgent(agentId);
      }
    }
  }
}

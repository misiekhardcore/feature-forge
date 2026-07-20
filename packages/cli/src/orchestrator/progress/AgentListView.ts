import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SelectItem, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { SelectList, Text } from "@earendil-works/pi-tui";

import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { AgentViewerState } from "./AgentViewerState";
import { BorderedContainer } from "./BorderedContainer";

/**
 * Renders the list of agent entries with their statuses using a
 * {@link SelectList} inside a {@link BorderedContainer}.
 */
export class AgentListView {
  private readonly state: AgentViewerState;
  private readonly theme: Theme;
  private readonly onSelectAgent: (agentId: string) => void;
  private readonly onDone: () => void;
  private lastEntryCount = -1;
  private _selectedIndex = 0;

  private readonly borderedContainer: BorderedContainer;
  private selectList?: SelectList;

  constructor(
    state: AgentViewerState,
    theme: Theme,
    _tui: TUI,
    onSelectAgent: (agentId: string) => void,
    onDone: () => void,
  ) {
    this.state = state;
    this.theme = theme;
    this.onSelectAgent = onSelectAgent;
    this.onDone = onDone;

    this.borderedContainer = new BorderedContainer(theme, "Agent Viewer");
    this.rebuild();
  }

  /** Index of the currently selected item. */
  get selectedIndex(): number {
    return this._selectedIndex;
  }

  set selectedIndex(index: number) {
    this._selectedIndex = index;
    this.selectList?.setSelectedIndex(index);
  }

  /**
   * Rebuild the {@link SelectList} with current agent entries.
   */
  private rebuild(): void {
    const entries = Array.from(this.state.getAgentEntries().entries());
    if (entries.length === 0) {
      this.borderedContainer.clear();
      const text = new Text(this.theme.fg("muted", "no agents running"));
      this.borderedContainer.addChild(text);
      this.selectList = undefined;
      return;
    }

    const items: SelectItem[] = entries.map(([id, entry]) => {
      const { char: icon } = AgentDisplayHelpers.getStatusIcon(entry.status, entry.passed);
      const elapsed = AgentDisplayHelpers.formatElapsed(entry.createdAt);
      const role = entry.role ? `(${entry.role})` : "";
      const label = `${icon} ${id} ${role} ${elapsed}`;
      const lastLine = this.state.getLastLine(id);
      const description = lastLine ? lastLine.slice(0, 60) : entry.summary?.slice(0, 60);
      return { value: id, label, description };
    });

    const selectTheme: SelectListTheme = {
      selectedPrefix: (text: string) => `→ ${text}`,
      selectedText: (text: string) => text,
      description: (text: string) => this.theme.fg("muted", text),
      scrollInfo: (text: string) => this.theme.fg("muted", text),
      noMatch: (text: string) => this.theme.fg("muted", text),
    };

    const list = new SelectList(items, 15, selectTheme);
    list.onSelect = (item: SelectItem) => this.onSelectAgent(item.value);
    list.onCancel = () => this.onDone();
    list.onSelectionChange = (item: SelectItem) => {
      this._selectedIndex = entries.findIndex(([id]) => id === item.value);
    };

    this.borderedContainer.clear();
    this.borderedContainer.addChild(list);
    this.selectList = list;
  }

  /**
   * Render the agent list inside a bordered container.
   *
   * Rebuilds the {@link SelectList} when the entry count changes.
   */
  render(width: number): string[] {
    const currentCount = this.state.entryCount;
    if (currentCount !== this.lastEntryCount) {
      this.lastEntryCount = currentCount;
      this.rebuild();
    }
    return this.borderedContainer.render(width);
  }

  /**
   * Handle keyboard input delegated to the {@link SelectList}.
   *
   * Rebuilds the {@link SelectList} first if the entry count has
   * changed since the last render.
   */
  handleInput(data: string): void {
    const currentCount = this.state.entryCount;
    if (currentCount !== this.lastEntryCount) {
      this.lastEntryCount = currentCount;
      this.rebuild();
    }
    this.selectList?.handleInput(data);
  }
}

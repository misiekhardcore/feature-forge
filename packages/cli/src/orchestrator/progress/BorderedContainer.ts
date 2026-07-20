import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Container that renders a static set of pre-built lines.
 *
 * Used internally by {@link BorderedContainer.fromLines} to wrap
 * pre-rendered content that does not come from a live Component tree.
 */
export class StaticContent extends Container {
  private readonly lines: string[];

  constructor(lines: string[]) {
    super();
    this.lines = lines;
  }

  render(_width: number): string[] {
    return this.lines;
  }
}

/**
 * Container that wraps its children in a box-drawing border with
 * optional title and inner margins.
 */
export class BorderedContainer extends Container {
  private readonly theme: Theme;
  private readonly title?: string;
  private readonly innerMargin: number;
  private readonly borderColor: ThemeColor;

  constructor(theme: Theme, title?: string, innerMargin = 1, borderColor: ThemeColor = "border") {
    super();
    this.theme = theme;
    this.title = title;
    this.innerMargin = innerMargin;
    this.borderColor = borderColor;
  }

  /**
   * Convenience helper: render a bordered box around pre-built lines.
   *
   * Creates a {@link BorderedContainer} wrapping a {@link StaticContent}
   * child and returns the rendered output.
   */
  static fromLines(
    lines: string[],
    outerWidth: number,
    theme: Theme,
    borderColor: ThemeColor = "border",
  ): string[] {
    const container = new BorderedContainer(theme, undefined, 1, borderColor);
    container.addChild(new StaticContent(lines));
    return container.render(outerWidth);
  }

  /**
   * Content width available inside the border (subtracts 2 border chars
   * and 2 inner margin spaces).
   */
  static contentWidth(outerWidth: number): number {
    return Math.max(0, outerWidth - 4);
  }

  render(width: number): string[] {
    const borderFn = (s: string): string => this.theme.fg(this.borderColor, s);
    const contentWidth = BorderedContainer.contentWidth(width);
    const innerBorderWidth = contentWidth + 2;

    const result: string[] = [];

    // Top border with optional title (truncated to fit).
    const maxTitleLen = innerBorderWidth - 1;
    const rawTitle = this.title ? ` ${this.title} ` : "";
    const titleSuffix =
      rawTitle.length > maxTitleLen
        ? rawTitle.slice(0, Math.max(0, maxTitleLen - 1)) + "…"
        : rawTitle;
    const topDash = "─".repeat(Math.max(1, innerBorderWidth - titleSuffix.length));
    result.push(borderFn(`┌${titleSuffix}${topDash}┐`));

    // Top inner margin.
    for (let i = 0; i < this.innerMargin; i++) {
      result.push(borderFn("│") + " ".repeat(innerBorderWidth) + borderFn("│"));
    }

    // Render children.
    for (const child of this.children) {
      for (const raw of child.render(width)) {
        const normalized = truncateToWidth(raw, contentWidth, "", true);
        result.push(borderFn("│") + " " + normalized.padEnd(contentWidth) + " " + borderFn("│"));
      }
    }

    // Bottom inner margin.
    for (let i = 0; i < this.innerMargin; i++) {
      result.push(borderFn("│") + " ".repeat(innerBorderWidth) + borderFn("│"));
    }

    // Bottom border.
    result.push(borderFn("└" + "─".repeat(innerBorderWidth) + "┘"));

    return result;
  }
}

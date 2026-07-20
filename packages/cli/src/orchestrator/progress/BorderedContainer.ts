import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Container that wraps its children in a box-drawing border with
 * optional title and inner margins.
 *
 * Border colour uses {@link Theme.fg}("border", …), consistent with
 * pi-coding-agent's {@code DynamicBorder} component.
 */
export class BorderedContainer extends Container {
  private readonly theme: Theme;
  private readonly title?: string;
  private readonly innerMargin: number;

  constructor(theme: Theme, title?: string, innerMargin = 1) {
    super();
    this.theme = theme;
    this.title = title;
    this.innerMargin = innerMargin;
  }

  /**
   * Content width available inside the border (subtracts 2 border chars
   * and 2 inner margin spaces).
   */
  static contentWidth(outerWidth: number): number {
    return Math.max(0, outerWidth - 4);
  }

  render(width: number): string[] {
    const borderFn = (s: string): string => this.theme.fg("border", s);
    const contentWidth = BorderedContainer.contentWidth(width);
    const innerBorderWidth = contentWidth + 2;

    const result: string[] = [];

    // Top border with optional title.
    const titleSuffix = this.title ? ` ${this.title} ` : "";
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

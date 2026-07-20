import type { Theme } from "@earendil-works/pi-coding-agent";

import { BorderedContainer } from "./BorderedContainer";

/**
 * Layout constants and utilities shared by agent viewer components.
 */
export abstract class AgentViewerBase {
  /** Combined width of left + right border characters ("│" + "│" = 2). */
  static readonly BORDER_CHARS = 2;

  /** Combined width of inner margin spaces (1 space on each side of content). */
  static readonly BORDER_MARGIN = 2;

  /** Total horizontal overhead: border chars + inner margins. */
  static readonly BORDER_WIDTH_OVERHEAD =
    AgentViewerBase.BORDER_CHARS + AgentViewerBase.BORDER_MARGIN;

  /** Total vertical overhead: top border, top margin, bottom margin, bottom border. */
  static readonly BORDER_HEIGHT_OVERHEAD = 4;

  /**
   * Format a human-readable elapsed time string from a creation timestamp.
   *
   * Computed dynamically so the value stays current when the overlay is open.
   * The result is not cached — callers should compute it at render time.
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

  /**
   * Compute the content width available inside the border, clamped to 0
   * so that zero-width terminals never produce negative dimensions.
   */
  static contentWidth(outerWidth: number): number {
    return Math.max(0, outerWidth - AgentViewerBase.BORDER_WIDTH_OVERHEAD);
  }

  /**
   * Render a bordered box around the given content lines.
   *
   * Delegates to {@link BorderedContainer.fromLines} with the
   * {@code "warning"} border colour to match the existing visual
   * convention.
   */
  static addBorder(lines: string[], outerWidth: number, theme: Theme): string[] {
    return BorderedContainer.fromLines(lines, outerWidth, theme, "warning");
  }
}

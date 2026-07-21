import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { BorderedContainer } from "./BorderedContainer";

class FakeTextAnsi extends Container {
  private readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  render(_width: number): string[] {
    // Returns text with ANSI escape codes that have 0 visible width.
    return [`\x1b[31m${this.text}\x1b[0m`];
  }
}

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
  } as unknown as Theme;
}

class FakeText extends Container {
  private readonly text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  render(_width: number): string[] {
    return [this.text];
  }
}

describe("BorderedContainer", () => {
  describe("contentWidth", () => {
    it("returns outer width minus border + margin overhead", () => {
      expect(BorderedContainer.contentWidth(80)).toBe(76);
    });

    it("returns 0 for narrow widths", () => {
      expect(BorderedContainer.contentWidth(3)).toBe(0);
      expect(BorderedContainer.contentWidth(0)).toBe(0);
    });

    it("returns non-negative for negative widths", () => {
      expect(BorderedContainer.contentWidth(-5)).toBe(0);
    });
  });

  describe("render", () => {
    it("renders empty box with no title and no children", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      const lines = box.render(80);

      // Should have: top + topInner + bottomInner + bottom = 4 lines
      expect(lines).toHaveLength(4);
      expect(lines[0]).toMatch(/^┌─+┐$/);
      expect(lines[1]).toMatch(/^│\s+│$/);
      expect(lines[2]).toMatch(/^│\s+│$/);
      expect(lines[3]).toMatch(/^└─+┘$/);
    });

    it("renders title in top border when provided", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme, "Test Title");
      const lines = box.render(80);

      expect(lines[0]).toContain("Test Title");
      expect(lines[0]).toMatch(/^┌.*─+┐$/);
    });

    it("renders children with padding", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      box.addChild(new FakeText("Hello"));
      const lines = box.render(80);

      // top + topInner + 1 child + bottomInner + bottom = 5 lines
      expect(lines).toHaveLength(5);
      // Child line should be: │ Hello<...padded...> │
      expect(lines[2]).toMatch(/^│ Hello\s+│$/);
    });

    it("pads child content to fill content width", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      box.addChild(new FakeText("A"));
      const lines = box.render(20);

      // contentWidth = 16, child line: │ A<...15 spaces...> │
      const childLine = lines[2];
      expect(childLine.startsWith("│ ")).toBe(true);
      expect(childLine.endsWith(" │")).toBe(true);
      // Total visible length = 20
      expect(childLine.length).toBe(20);
    });

    it("truncates child content exceeding content width", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      // contentWidth(10) = 6, so this long string gets truncated to 6 chars
      box.addChild(new FakeText("ABCDEFGHIJKLMNOP"));
      const lines = box.render(10);

      const childLine = lines[2];
      // truncateToWidth may append ANSI reset codes; verify visible content.
      expect(childLine).toMatch(/^│ ABCDEF/);
      expect(childLine).toMatch(/ │$/);
      expect(childLine).not.toContain("GHIJKLMNOP");
    });

    it("renders multiple children", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      box.addChild(new FakeText("First"));
      box.addChild(new FakeText("Second"));
      const lines = box.render(80);

      // top + topInner + 2 children + bottomInner + bottom = 6 lines
      expect(lines).toHaveLength(6);
      expect(lines[2]).toContain("First");
      expect(lines[3]).toContain("Second");
    });

    it("applies theme border color via fg('border', ...)", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme, "Title");
      box.addChild(new FakeText("Content"));
      box.render(80);

      // Every line of the border should be themed
      expect(theme.fg).toHaveBeenCalledWith("border", expect.any(String));
    });

    it("accepts custom inner margin", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme, undefined, 2);
      box.addChild(new FakeText("X"));
      const lines = box.render(80);

      // top + 2 topInner + 1 child + 2 bottomInner + bottom = 7 lines
      expect(lines).toHaveLength(7);
    });

    it("renders correctly with zero inner margin", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme, undefined, 0);
      box.addChild(new FakeText("Content"));
      const lines = box.render(80);

      // top + 1 child + bottom = 3 lines (no inner margins)
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain("Content");
    });

    it("handles ANSI-encoded child content without breaking escape sequences", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      box.addChild(new FakeTextAnsi("Hello"));
      // width 10 → contentWidth = 6, so "Hello" fits with padding.
      const lines = box.render(10);
      const childLine = lines[2];
      // Content should still contain the visible text with ANSI codes intact.
      expect(childLine).toContain("Hello");
      // Escape codes must be preserved.
      expect(childLine).toContain("\x1b[31m");
      expect(childLine).toContain("\x1b[0m");
    });

    it("truncates ANSI-encoded child content exceeding content width", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme);
      box.addChild(new FakeTextAnsi("ABCDEFGHIJKLMNOP"));
      // width 10 → contentWidth = 6, so visible text truncated to 6 chars.
      const lines = box.render(10);
      const childLine = lines[2];
      // Should NOT contain characters beyond the 6-char visible width.
      expect(childLine).not.toContain("GHIJKLMNOP");
      // Escape codes must still be intact.
      expect(childLine).toContain("\x1b[31m");
      expect(childLine).toContain("\x1b[0m");
    });

    it("truncates long title so top border does not overflow", () => {
      const theme = makeTheme();
      const longTitle = "A".repeat(100);
      const box = new BorderedContainer(theme, longTitle);
      const lines = box.render(80);

      // Top border line must not exceed outer width.
      const topLine = lines[0];
      // Allow for ANSI codes that may wrap the line.
      // eslint-disable-next-line no-control-regex
      const visibleLen = topLine.replace(/\x1b\[[0-9;]*m/g, "").length;
      expect(visibleLen).toBeLessThanOrEqual(80);
      // The title should have been truncated with ellipsis.
      expect(topLine).toContain("…");
    });

    it("truncates title with multi-byte characters without breaking glyphs", () => {
      const theme = makeTheme();
      // Title with emoji and CJK — each emoji is 2 columns wide, CJK is 2 columns.
      const multiByteTitle = "🚀 日本語テスト";
      const box = new BorderedContainer(theme, multiByteTitle);
      const lines = box.render(20);

      const topLine = lines[0];
      // Visible length must not exceed outer width (20).
      // eslint-disable-next-line no-control-regex
      const visibleLen = topLine.replace(/\x1b\[[0-9;]*m/g, "").length;
      expect(visibleLen).toBeLessThanOrEqual(20);
      // Should contain at least the emoji (visible char).
      expect(topLine).toContain("🚀");
      // The top border should end with ┐ at the exact right edge.
      expect(topLine).toMatch(/┐$/);
      // The border should begin with ┌.
      expect(topLine).toMatch(/^┌/);
    });

    it("accepts custom borderColor parameter", () => {
      const theme = makeTheme();
      const box = new BorderedContainer(theme, undefined, 1, "warning");
      box.addChild(new FakeText("Content"));
      box.render(80);

      // Should use "warning" instead of default "border".
      expect(theme.fg).toHaveBeenCalledWith("warning", expect.any(String));
    });
  });

  describe("fromLines", () => {
    it("wraps pre-built lines in a bordered box", () => {
      const theme = makeTheme();
      const result = BorderedContainer.fromLines(["Line 1", "Line 2"], 80, theme, "warning");

      // Should have border structure: top + topInner + 2 lines + bottomInner + bottom = 6
      expect(result).toHaveLength(6);
      expect(result[0]).toMatch(/^┌─+┐$/);
      expect(result[2]).toContain("Line 1");
      expect(result[3]).toContain("Line 2");
      expect(result[5]).toMatch(/^└─+┘$/);
      expect(theme.fg).toHaveBeenCalledWith("warning", expect.any(String));
    });
  });
});

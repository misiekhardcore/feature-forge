import { Box, Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { makeRenderContext, makeRenderOptions, makeTheme } from "../../test-utils";
import { ToolRenderer } from "./ToolRenderer";

describe("ToolRenderer", () => {
  describe("header (general)", () => {
    it("wraps text in bold and the given colour", () => {
      expect(ToolRenderer.header(makeTheme(), "success", "spawn_agent")).toBe(
        "[success]<b>spawn_agent</b>[/success]",
      );
    });
  });

  describe("shell (general)", () => {
    it("returns a Box and stores it in ctx.state._box", () => {
      const ctx = makeRenderContext();
      const box = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => b.line("hello"));

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("reuses the same Box on subsequent calls", () => {
      const ctx = makeRenderContext();
      const first = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => b.line("one"));
      const second = ToolRenderer.shell(ctx, makeTheme(), "toolSuccessBg", (b) => b.line("two"));

      expect(second).toBe(first);
    });

    it("wraps rendered lines in the given background colour", () => {
      const box = ToolRenderer.shell(makeRenderContext(), makeTheme(), "toolErrorBg", (b) =>
        b.line("x"),
      );

      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("[bg:toolErrorBg]");
      expect(rendered).toContain("[/bg]");
    });

    it("truncates long collapsed content without throwing", () => {
      const ctx = makeRenderContext();
      const longText = "x".repeat(500);
      const box = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => b.line(longText));

      const rendered = box.render(80).join(" ");
      expect(rendered).not.toContain("x".repeat(500));
    });

    it("expanded mode renders one Text per line", () => {
      const ctx = makeRenderContext({ expanded: true });
      const box = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => {
        b.line("first");
        b.expandable("alpha\nbeta");
      });

      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("alpha");
      expect(rendered).toContain("beta");
    });

    it("collapsed expandable no-ops for undefined or empty text", () => {
      const ctx = makeRenderContext();
      const box = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => {
        b.line("first");
        b.expandable(undefined);
        b.expandable("");
        b.line("last");
      });

      // The guard (`if (!text) return`) adds no child rows for empty input.
      expect(box.children).toHaveLength(2);
      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("first");
      expect(rendered).toContain("last");
    });

    it("collapsed unstyled expandable renders text without colour wrappers", () => {
      const ctx = makeRenderContext();
      const box = ToolRenderer.shell(ctx, makeTheme(), "toolPendingBg", (b) => {
        b.line("header");
        b.expandable("plain text");
      });

      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("plain text");
      expect(rendered).not.toContain("[muted]");
      expect(rendered).not.toContain("[success]");
    });
  });

  describe("simpleResult (general)", () => {
    it("returns an empty Text for partial results", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: { ok: true } },
        makeRenderOptions({ isPartial: true }),
        makeTheme(),
        makeRenderContext(),
      );

      expect(result).toBeInstanceOf(Text);
      expect(result.render(80)).toEqual([]);
    });

    it("adds an error marker when details carry an error", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: { error: "something broke" } },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ something broke");
      expect(rendered).toContain("[error]");
    });

    it("adds an error marker with the message when the context signals an error", () => {
      const result = ToolRenderer.simpleResult(
        { content: [{ type: "text" as const, text: "tool aborted mid-run" }], details: {} },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext({ isError: true }),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ tool aborted mid-run");
      expect(rendered).toContain("[error]");
    });

    it("falls back to a failed marker for errored results with no message", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: {} },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext({ isError: true }),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ failed");
      expect(rendered).toContain("[error]");
    });

    it("adds a muted done marker on success", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: { agentId: "agent-1" } },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✓ done");
      expect(rendered).toContain("[muted]");
    });

    it("treats an empty-string details error as no error", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: { error: "" } },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✓ done");
      expect(rendered).not.toContain("✗");
    });

    it("treats a null details error as no error", () => {
      const result = ToolRenderer.simpleResult(
        { content: [], details: { error: null } },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✓ done");
      expect(rendered).not.toContain("✗");
    });
  });

  describe("messageResult (general)", () => {
    it("returns an empty Text for partial results", () => {
      const result = ToolRenderer.messageResult(
        { content: [{ type: "text" as const, text: "" }], details: undefined },
        makeRenderOptions({ isPartial: true }),
        makeTheme(),
        makeRenderContext(),
      );

      expect(result).toBeInstanceOf(Text);
      expect(result.render(80)).toEqual([]);
    });

    it("adds an error marker with the message when the context signals an error", () => {
      const result = ToolRenderer.messageResult(
        { content: [{ type: "text" as const, text: "no active flow" }], details: {} },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext({ isError: true }),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ no active flow");
      expect(rendered).toContain("[error]");
    });

    it("falls back to a failed marker for errored results with no message", () => {
      const result = ToolRenderer.messageResult(
        { content: [], details: {} },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext({ isError: true }),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ failed");
      expect(rendered).toContain("[error]");
    });

    it("renders the content message in the success colour", () => {
      const result = ToolRenderer.messageResult(
        {
          content: [{ type: "text" as const, text: "Session param set: workspace: /path" }],
          details: undefined,
        },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("Session param set: workspace: /path");
      expect(rendered).toContain("[success]");
    });

    it("falls back to a muted done marker when content carries no message", () => {
      const result = ToolRenderer.messageResult(
        { content: [], details: undefined },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✓ done");
      expect(rendered).toContain("[muted]");
    });

    it("joins text content parts and filters out non-text parts", () => {
      const result = ToolRenderer.messageResult(
        {
          content: [
            { type: "text" as const, text: "Session param set: workspace: /path" },
            { type: "image" as const, data: "image: leaked placeholder", mimeType: "image/png" },
            { type: "text" as const, text: "mode: strict" },
          ],
          details: undefined,
        },
        makeRenderOptions(),
        makeTheme(),
        makeRenderContext(),
      );

      const rendered = result.render(80).map((l) => l.trim());
      expect(rendered.join(" ")).toContain("Session param set: workspace: /path");
      expect(rendered.join(" ")).toContain("mode: strict");
      // The image part's placeholder payload must not leak into the output.
      expect(rendered.join(" ")).not.toContain("image: leaked placeholder");
    });
  });
});

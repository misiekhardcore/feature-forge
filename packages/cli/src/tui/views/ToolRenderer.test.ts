import { Box, Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { ToolRenderer } from "./ToolRenderer";

function makeTheme() {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/bg]`,
    bold: (text: string) => `<b>${text}</b>`,
  } as never;
}

function makeCtx() {
  return { state: {} as Record<string, unknown>, expanded: false };
}

describe("ToolRenderer", () => {
  const theme = makeTheme();

  describe("spawnAgentCall", () => {
    it("renders a Box with label and no model", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.spawnAgentCall(
        { role: "reviewer", systemPrompt: "", toolRestrictions: {} },
        theme,
        ctx,
      );

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("renders a Box with role and model override", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.spawnAgentCall(
        { role: "reviewer", systemPrompt: "", toolRestrictions: {}, model: "claude-sonnet-4-5" },
        theme,
        ctx,
      );

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("sendTaskCall", () => {
    it("renders a Box with agent id and prompt snippet", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.sendTaskCall(
        { agentId: "agent-1", prompt: "review the code", await: true },
        theme,
        ctx,
      );

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("truncates long prompt descriptions", () => {
      const ctx = makeCtx();
      const longPrompt = "a".repeat(100);
      ToolRenderer.sendTaskCall(
        { agentId: "agent-1", prompt: longPrompt, await: false },
        theme,
        ctx,
      );

      // Should not throw — just verifies truncation path
    });
  });

  describe("getAgentResultCall", () => {
    it("renders a Box with agent id", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.getAgentResultCall({ agentId: "agent-1" }, theme, ctx);

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("destroyAgentCall", () => {
    it("renders a Box with agent id", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.destroyAgentCall({ agentId: "agent-1" }, theme, ctx);

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("listAgentsCall", () => {
    it("renders a Box with tool name", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.listAgentsCall({}, theme, ctx);

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("setFlowParamCall", () => {
    it("renders a Box with key and stores it in state", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.setFlowParamCall({ key: "mode", value: "strict" }, theme, ctx);

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("truncates long values to a single collapsed line", () => {
      const ctx = makeCtx();
      const longValue = "v".repeat(500);
      const box = ToolRenderer.setFlowParamCall({ key: "key", value: longValue }, theme, ctx);

      // Collapsed mode renders the header plus one TruncatedText line, so the
      // long value must be cut down instead of wrapping.
      const rendered = box.render(80);
      expect(rendered.filter((l) => l.includes("[muted]"))).toHaveLength(1);
      expect(rendered.join(" ")).not.toContain("v".repeat(500));
    });

    it("renders one Text per value line when expanded", () => {
      const value = "alpha\nbeta\n" + "v".repeat(500);
      const collapsed = ToolRenderer.setFlowParamCall({ key: "key", value }, theme, {
        state: {},
        expanded: false,
      });
      const expanded = ToolRenderer.setFlowParamCall({ key: "key", value }, theme, {
        state: {},
        expanded: true,
      });

      const collapsedLines = collapsed.render(80);
      const expandedLines = expanded.render(80);

      // Expanded path emits one Text per value line, so a multi-line value
      // renders more value lines than the single truncated collapsed line.
      expect(collapsedLines.filter((l) => l.includes("[muted]"))).toHaveLength(1);
      expect(expandedLines.filter((l) => l.includes("[muted]")).length).toBeGreaterThan(1);
      expect(expandedLines.join(" ")).toContain("alpha");
      expect(expandedLines.join(" ")).toContain("beta");
    });
  });

  describe("setSessionNameCall", () => {
    it("renders a Box with the session name in the header", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.setSessionNameCall({ name: "implement #172" }, theme, ctx);

      expect(box).toBeInstanceOf(Box);
      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("set_session_name implement #172");
    });

    it("renders the header when expanded", () => {
      const box = ToolRenderer.setSessionNameCall({ name: "implement #172" }, theme, {
        state: {},
        expanded: true,
      });

      const rendered = box.render(80).join(" ");
      expect(rendered).toContain("set_session_name implement #172");
    });
  });

  describe("setFlowParamResult (shared with setSessionNameResult)", () => {
    it("returns an empty Text for partial results", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.setFlowParamResult(
        { content: [{ type: "text" as const, text: "" }], details: undefined },
        { expanded: false, isPartial: true },
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Text);
      expect(result.render(80)).toEqual([]);
    });

    it("adds success text for successful results", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.setFlowParamResult(
        {
          content: [{ type: "text" as const, text: "Session param set: workspace: /path" }],
          details: undefined,
        },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("Session param set: workspace: /path");
      expect(rendered).toContain("[success]");
    });

    it("adds error text when the context signals an error", () => {
      const result = ToolRenderer.setFlowParamResult(
        {
          content: [{ type: "text" as const, text: "set_flow_param: no active flow" }],
          details: {},
        },
        { expanded: false, isPartial: false },
        theme,
        { state: {}, isError: true },
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ set_flow_param: no active flow");
      expect(rendered).toContain("[error]");
    });

    it("falls back to failed text for errored results with no message", () => {
      const result = ToolRenderer.setFlowParamResult(
        { content: [], details: {} },
        { expanded: false, isPartial: false },
        theme,
        { state: {}, isError: true },
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✗ failed");
      expect(rendered).toContain("[error]");
    });

    it("joins text content parts with newlines and filters out non-text parts", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.setFlowParamResult(
        {
          content: [
            { type: "text" as const, text: "Session param set: workspace: /path" },
            { type: "image" as const, data: "image: leaked placeholder", mimeType: "image/png" },
            { type: "text" as const, text: "mode: strict" },
          ],
          details: undefined,
        },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );

      // The text parts are joined with "\n" (one rendered line per part); the
      // image part is filtered out entirely. Assert the rendered shape
      // semantically instead of the exact line split, which depends on pi-tui's
      // internal handling of styled multi-line strings.
      const rendered = result.render(80).map((l) => l.trim());
      expect(rendered).toHaveLength(2);
      expect(rendered.join(" ")).toContain("Session param set: workspace: /path");
      expect(rendered.join(" ")).toContain("mode: strict");
      // The image part's placeholder payload must not leak into the output.
      expect(rendered.join(" ")).not.toContain("image:");
    });

    it("falls back to done text when content carries no message", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.setFlowParamResult(
        { content: [], details: undefined },
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );

      const rendered = result.render(80).join(" ");
      expect(rendered).toContain("✓ done");
      expect(rendered).toContain("[muted]");
    });
  });

  describe("setSessionNameResult", () => {
    it("is an alias of setFlowParamResult", () => {
      expect(ToolRenderer.setSessionNameResult).toBe(ToolRenderer.setFlowParamResult);
    });
  });

  describe("spawnAgentResult (shared result renderer)", () => {
    it("returns the Box from state for partial results", () => {
      const ctx = makeCtx();
      ctx.state._box = new Box(1, 0);

      const result = ToolRenderer.spawnAgentResult(
        { content: [{ type: "text" as const, text: "" }], details: { ok: true } },
        { isPartial: true } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Text);
    });

    it("adds error text for failed results", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.spawnAgentResult(
        {
          content: [{ type: "text" as const, text: "error" }],
          details: { error: "something broke" },
        },
        { isPartial: false } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Text);
    });

    it("adds done text for successful results", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.spawnAgentResult(
        { content: [{ type: "text" as const, text: "ok" }], details: { field: "value" } },
        { isPartial: false } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Text);
    });

    it("returns empty Text when box is missing from state", () => {
      const ctx = makeCtx();

      const result = ToolRenderer.spawnAgentResult(
        { content: [{ type: "text" as const, text: "ok" }], details: {} },
        { isPartial: false } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Text);
    });
  });

  describe("Box reuse across calls", () => {
    it("reuses the same Box instance on subsequent renderCall invocations", () => {
      const ctx = makeCtx();

      const first = ToolRenderer.spawnAgentCall(
        { role: "reviewer", systemPrompt: "", toolRestrictions: {} },
        theme,
        ctx,
      );
      const second = ToolRenderer.spawnAgentCall(
        { role: "writer", systemPrompt: "", toolRestrictions: { read: [] } },
        theme,
        ctx,
      );

      expect(first).toBe(second);
    });
  });
});

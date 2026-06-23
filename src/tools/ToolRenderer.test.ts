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
  return { state: {} as Record<string, unknown> } as { state: Record<string, unknown> };
}

describe("ToolRenderer", () => {
  const theme = makeTheme();

  describe("spawnAgentCall", () => {
    it("renders a Box with role and no model", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.spawnAgentCall(
        { role: "reviewer", systemPrompt: "", toolNames: [] },
        theme,
        ctx,
      ) as Box;

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("renders a Box with role and model override", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.spawnAgentCall(
        { role: "reviewer", systemPrompt: "", toolNames: [], model: "claude-sonnet-4-5" },
        theme,
        ctx,
      ) as Box;

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("sendTaskCall", () => {
    it("renders a Box with agent identifier and task snippet", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.sendTaskCall(
        { agentIdentifier: "agent-1", task: "review the code", await: true },
        theme,
        ctx,
      ) as Box;

      expect(box).toBeInstanceOf(Box);
      expect(ctx.state._box).toBe(box);
    });

    it("truncates long task descriptions", () => {
      const ctx = makeCtx();
      const longTask = "a".repeat(100);
      ToolRenderer.sendTaskCall(
        { agentIdentifier: "agent-1", task: longTask, await: false },
        theme,
        ctx,
      );

      // Should not throw — just verifies truncation path
    });
  });

  describe("getAgentResultCall", () => {
    it("renders a Box with agent identifier", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.getAgentResultCall(
        { agentIdentifier: "agent-1" },
        theme,
        ctx,
      ) as Box;

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("destroyAgentCall", () => {
    it("renders a Box with agent identifier", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.destroyAgentCall({ agentIdentifier: "agent-1" }, theme, ctx) as Box;

      expect(box).toBeInstanceOf(Box);
    });
  });

  describe("listAgentsCall", () => {
    it("renders a Box with tool name", () => {
      const ctx = makeCtx();
      const box = ToolRenderer.listAgentsCall({}, theme, ctx) as Box;

      expect(box).toBeInstanceOf(Box);
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

      expect(result).toBe(ctx.state._box);
    });

    it("adds error text for failed results", () => {
      const ctx = makeCtx();
      ctx.state._box = new Box(1, 0);

      const result = ToolRenderer.spawnAgentResult(
        {
          content: [{ type: "text" as const, text: "error" }],
          details: { error: "something broke" },
        },
        { isPartial: false } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Box);
    });

    it("adds done text for successful results", () => {
      const ctx = makeCtx();
      ctx.state._box = new Box(1, 0);

      const result = ToolRenderer.spawnAgentResult(
        { content: [{ type: "text" as const, text: "ok" }], details: { field: "value" } },
        { isPartial: false } as never,
        theme,
        ctx,
      );

      expect(result).toBeInstanceOf(Box);
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
        { role: "reviewer", systemPrompt: "", toolNames: [] },
        theme,
        ctx,
      );
      const second = ToolRenderer.spawnAgentCall(
        { role: "writer", systemPrompt: "", toolNames: ["read"] },
        theme,
        ctx,
      );

      expect(first).toBe(second);
    });
  });
});

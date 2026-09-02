import { Box } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it } from "vitest";

import {
  makeMockSocketClient,
  makeRenderContext,
  makeRenderOptions,
  makeTheme,
  renderLines,
} from "../test-utils";
import { SpawnAgentTool } from "./SpawnAgentTool";

describe("SpawnAgentTool", () => {
  it("has name 'spawn_agent'", () => {
    const tool = new SpawnAgentTool(null);
    expect(tool.name).toBe("spawn_agent");
  });

  it("has a role", () => {
    const tool = new SpawnAgentTool(null);
    expect(tool.label).toBe("Spawn Agent");
  });

  it("has a description", () => {
    const tool = new SpawnAgentTool(null);
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters", () => {
    const tool = new SpawnAgentTool(null);
    expect(tool.parameters).toBeDefined();
  });

  it("includes skills and excludedSkills in parameters schema", () => {
    const tool = new SpawnAgentTool(null);
    const properties = tool.parameters.properties;
    expect(properties).toHaveProperty("skills");
    expect(properties).toHaveProperty("excludedSkills");
  });

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new SpawnAgentTool(null);
      const result = await tool.execute(
        "call-1",
        {
          role: "researcher",
          systemPrompt: "test",
          toolRestrictions: { read: [] },
        },
        undefined,
      );
      expect(result).toEqual({
        content: [
          { type: "text", text: JSON.stringify({ error: "Not available in orchestrator mode" }) },
        ],
        details: { error: "Not available in orchestrator mode" },
      });
    });
  });

  describe("with socket client", () => {
    let client: ReturnType<typeof makeMockSocketClient>;
    let tool: SpawnAgentTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new SpawnAgentTool(client);
    });

    it("sends request and returns formatted result", async () => {
      client.request.mockResolvedValue({ agentId: "agent-1", role: "researcher" });

      const result = await tool.execute(
        "call-1",
        {
          role: "researcher",
          systemPrompt: "You are a researcher",
          toolRestrictions: { read: [], bash: [] },
        },
        undefined,
      );

      expect(client.request).toHaveBeenCalledWith(
        "spawn_agent",
        {
          role: "researcher",
          systemPrompt: "You are a researcher",
          toolRestrictions: { read: [], bash: [] },
        },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({ agentId: "agent-1", role: "researcher" }, null, 2),
          },
        ],
        details: { agentId: "agent-1", role: "researcher" },
      });
    });

    it("forwards optional prompt to the IPC client", async () => {
      client.request.mockResolvedValue({ agentId: "build-1", role: "build" });

      await tool.execute(
        "call-2",
        {
          role: "build",
          systemPrompt: "You are a builder",
          toolRestrictions: { read: [] },
          prompt: "Add auth feature",
        },
        undefined,
      );

      expect(client.request).toHaveBeenCalledWith(
        "spawn_agent",
        {
          role: "build",
          systemPrompt: "You are a builder",
          toolRestrictions: { read: [] },
          prompt: "Add auth feature",
        },
        undefined,
        undefined,
      );
    });

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.execute(
        "call-1",
        {
          role: "researcher",
          systemPrompt: "test",
          toolRestrictions: {},
        },
        undefined,
      );

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Connection refused" }) }],
        details: { error: "Connection refused" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute(
        "call-1",
        {
          role: "researcher",
          systemPrompt: "test",
          toolRestrictions: {},
        },
        undefined,
      );

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });

    it("throws AbortError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        tool.execute(
          "call-1",
          { role: "x", systemPrompt: "x", toolRestrictions: {} },
          controller.signal,
        ),
      ).rejects.toThrow(DOMException);
      expect(client.request).not.toHaveBeenCalled();
    });
  });

  describe("rendering", () => {
    const tool = new SpawnAgentTool(null);
    const theme = makeTheme();

    it("renderCall renders a Box and stores it in the render context state", () => {
      const context = makeRenderContext();
      const component = tool.renderCall(
        { role: "researcher", systemPrompt: "You are a researcher", toolRestrictions: {} },
        theme,
        context,
      );

      expect(component).toBeInstanceOf(Box);
      expect(context.state._box).toBe(component);
      expect(renderLines(component).join(" ")).toContain("[bg:toolPendingBg]");
    });

    it("renderCall header contains spawn_agent and the role", () => {
      const lines = renderLines(
        tool.renderCall(
          { role: "researcher", systemPrompt: "You are a researcher", toolRestrictions: {} },
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines.join(" ")).toContain("spawn_agent researcher");
    });

    it("renderCall shows a muted model override when set", () => {
      const lines = renderLines(
        tool.renderCall(
          {
            role: "researcher",
            systemPrompt: "You are a researcher",
            toolRestrictions: {},
            model: "claude-sonnet-4-5",
          },
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines.join(" ")).toContain("claude-sonnet-4-5");
      expect(lines.join(" ")).toContain("[muted]");
    });

    it("renderCall handles a 500-char system prompt without throwing", () => {
      expect(() =>
        renderLines(
          tool.renderCall(
            { role: "researcher", systemPrompt: "x".repeat(500), toolRestrictions: {} },
            theme,
            makeRenderContext(),
          ),
        ),
      ).not.toThrow();
    });

    it("renderResult renders a muted done marker for a successful result", () => {
      const lines = renderLines(
        tool.renderResult(
          { content: [], details: { agentId: "agent-1", role: "researcher" } },
          makeRenderOptions(),
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines.join(" ")).toContain("✓ done");
      expect(lines.join(" ")).toContain("[muted]");
    });

    it("renderResult renders nothing while the result is partial", () => {
      const lines = renderLines(
        tool.renderResult(
          { content: [], details: undefined },
          makeRenderOptions({ isPartial: true }),
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines).toEqual([]);
    });

    it("renderResult renders an error marker when details carry an error", () => {
      const lines = renderLines(
        tool.renderResult(
          { content: [], details: { error: "Connection refused" } },
          makeRenderOptions(),
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines.join(" ")).toContain("✗ Connection refused");
    });
  });
});

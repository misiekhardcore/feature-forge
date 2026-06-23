import { beforeEach, describe, expect, it, vi } from "vitest";

import { SpawnAgentTool } from "./SpawnAgentTool";

function makeMockSocketClient() {
  return { request: vi.fn() };
}

describe("SpawnAgentTool", () => {
  it("has name 'spawn_agent'", () => {
    const tool = new SpawnAgentTool(null);
    expect(tool.name).toBe("spawn_agent");
  });

  it("has a label", () => {
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

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new SpawnAgentTool(null);
      const result = await tool.execute("call-1", {
        role: "researcher",
        systemPrompt: "test",
        toolNames: ["read"],
      });
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
      tool = new SpawnAgentTool(client as never);
    });

    it("sends request and returns formatted result", async () => {
      client.request.mockResolvedValue({ agentId: "agent-1", role: "researcher" });

      const result = await tool.execute("call-1", {
        role: "researcher",
        systemPrompt: "You are a researcher",
        toolNames: ["read", "bash"],
      });

      expect(client.request).toHaveBeenCalledWith("spawn_agent", {
        role: "researcher",
        systemPrompt: "You are a researcher",
        toolNames: ["read", "bash"],
      });
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

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Connection refused"));

      const result = await tool.execute("call-1", {
        role: "researcher",
        systemPrompt: "test",
        toolNames: [],
      });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Connection refused" }) }],
        details: { error: "Connection refused" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute("call-1", {
        role: "researcher",
        systemPrompt: "test",
        toolNames: [],
      });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });
  });
});

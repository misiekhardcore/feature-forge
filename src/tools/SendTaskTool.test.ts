import { beforeEach, describe, expect, it, vi } from "vitest";

import { SendTaskTool } from "./SendTaskTool";

function makeMockSocketClient() {
  return { request: vi.fn() };
}

describe("SendTaskTool", () => {
  it("has name 'send_task'", () => {
    const tool = new SendTaskTool(null);
    expect(tool.name).toBe("send_task");
  });

  it("has a label", () => {
    const tool = new SendTaskTool(null);
    expect(tool.label).toBe("Send Task");
  });

  it("has a description", () => {
    const tool = new SendTaskTool(null);
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters", () => {
    const tool = new SendTaskTool(null);
    expect(tool.parameters).toBeDefined();
  });

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new SendTaskTool(null);
      const result = await tool.execute("call-1", {
        agentIdentifier: "agent-1",
        task: "do something",
        await: true,
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
    let tool: SendTaskTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new SendTaskTool(client as never);
    });

    it("sends request with await: true and returns result", async () => {
      client.request.mockResolvedValue({ result: "task completed" });

      const result = await tool.execute("call-1", {
        agentIdentifier: "agent-1",
        task: "do something",
        await: true,
      });

      expect(client.request).toHaveBeenCalledWith("send_task", {
        agentIdentifier: "agent-1",
        task: "do something",
        await: true,
      });
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ result: "task completed" }, null, 2) }],
        details: { result: "task completed" },
      });
    });

    it("sends request with await: false and returns dispatched status", async () => {
      client.request.mockResolvedValue({ status: "dispatched" });

      const result = await tool.execute("call-1", {
        agentIdentifier: "agent-1",
        task: "background task",
        await: false,
      });

      expect(client.request).toHaveBeenCalledWith("send_task", {
        agentIdentifier: "agent-1",
        task: "background task",
        await: false,
      });
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ status: "dispatched" }, null, 2) }],
        details: { status: "dispatched" },
      });
    });

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Agent not found"));

      const result = await tool.execute("call-1", {
        agentIdentifier: "missing-agent",
        task: "test",
        await: true,
      });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }],
        details: { error: "Agent not found" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute("call-1", {
        agentIdentifier: "bad-agent",
        task: "test",
        await: true,
      });

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { makeMockSocketClient } from "../test-utils";
import { SendTaskTool } from "./SendTaskTool";

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
      const result = await tool.execute(
        "call-1",
        {
          agentId: "agent-1",
          prompt: "do something",
          await: true,
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
    let tool: SendTaskTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new SendTaskTool(client as never);
    });

    it("sends request with await: true and returns result", async () => {
      client.request.mockResolvedValue({ result: "task completed" });

      const result = await tool.execute(
        "call-1",
        {
          agentId: "agent-1",
          prompt: "do something",
          await: true,
        },
        undefined,
      );

      expect(client.request).toHaveBeenCalledWith(
        "send_task",
        {
          agentId: "agent-1",
          prompt: "do something",
          await: true,
        },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ result: "task completed" }, null, 2) }],
        details: { result: "task completed" },
      });
    });

    it("sends request with await: false and returns dispatched status", async () => {
      client.request.mockResolvedValue({ status: "dispatched" });

      const result = await tool.execute(
        "call-1",
        {
          agentId: "agent-1",
          prompt: "background task",
          await: false,
        },
        undefined,
      );

      expect(client.request).toHaveBeenCalledWith(
        "send_task",
        {
          agentId: "agent-1",
          prompt: "background task",
          await: false,
        },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ status: "dispatched" }, null, 2) }],
        details: { status: "dispatched" },
      });
    });

    it("threads timeout through to client.request when set", async () => {
      client.request.mockResolvedValue({ result: "done" });

      await tool.execute(
        "call-1",
        {
          agentId: "agent-1",
          prompt: "long task",
          await: true,
          timeout: 1_800_000,
        },
        undefined,
      );

      expect(client.request).toHaveBeenCalledWith(
        "send_task",
        expect.objectContaining({ timeout: 1_800_000 }),
        1_800_000,
        undefined,
      );
    });

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Agent not found"));

      const result = await tool.execute(
        "call-1",
        {
          agentId: "missing-agent",
          prompt: "test",
          await: true,
        },
        undefined,
      );

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }],
        details: { error: "Agent not found" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute(
        "call-1",
        {
          agentId: "bad-agent",
          prompt: "test",
          await: true,
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
          { agentId: "agent-1", prompt: "task", await: true },
          controller.signal,
        ),
      ).rejects.toThrow(DOMException);
      expect(client.request).not.toHaveBeenCalled();
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { makeMockSocketClient } from "../test-utils";
import { GetAgentResultTool } from "./GetAgentResultTool";

describe("GetAgentResultTool", () => {
  it("has name 'get_agent_result'", () => {
    const tool = new GetAgentResultTool(null);
    expect(tool.name).toBe("get_agent_result");
  });

  it("has a label", () => {
    const tool = new GetAgentResultTool(null);
    expect(tool.label).toBe("Get Agent Result");
  });

  it("has a description", () => {
    const tool = new GetAgentResultTool(null);
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters", () => {
    const tool = new GetAgentResultTool(null);
    expect(tool.parameters).toBeDefined();
  });

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new GetAgentResultTool(null);
      const result = await tool.execute("call-1", { agentId: "agent-1" }, undefined);
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
    let tool: GetAgentResultTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new GetAgentResultTool(client as never);
    });

    it("sends request and returns agent status with result", async () => {
      client.request.mockResolvedValue({ status: "Completed", result: "task output" });

      const result = await tool.execute("call-1", { agentId: "agent-1" }, undefined);

      expect(client.request).toHaveBeenCalledWith(
        "get_agent_result",
        {
          agentId: "agent-1",
        },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({ status: "Completed", result: "task output" }, null, 2),
          },
        ],
        details: { status: "Completed", result: "task output" },
      });
    });

    it("handles agent with null result", async () => {
      client.request.mockResolvedValue({ status: "Running", result: null });

      const result = await tool.execute("call-1", { agentId: "agent-1" }, undefined);

      expect(result).toEqual({
        content: [
          { type: "text", text: JSON.stringify({ status: "Running", result: null }, null, 2) },
        ],
        details: { status: "Running", result: null },
      });
    });

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Agent not found"));

      const result = await tool.execute("call-1", { agentId: "missing-agent" }, undefined);

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }],
        details: { error: "Agent not found" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute("call-1", { agentId: "bad-agent" }, undefined);

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });

    it("throws AbortError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        tool.execute("call-1", { agentId: "agent-1" }, controller.signal),
      ).rejects.toThrow(DOMException);
      expect(client.request).not.toHaveBeenCalled();
    });
  });
});

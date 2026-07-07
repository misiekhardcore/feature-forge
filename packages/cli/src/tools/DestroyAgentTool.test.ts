import { beforeEach, describe, expect, it } from "vitest";

import { makeMockSocketClient } from "../test-utils";
import { DestroyAgentTool } from "./DestroyAgentTool";

describe("DestroyAgentTool", () => {
  it("has name 'destroy_agent'", () => {
    const tool = new DestroyAgentTool(null);
    expect(tool.name).toBe("destroy_agent");
  });

  it("has a label", () => {
    const tool = new DestroyAgentTool(null);
    expect(tool.label).toBe("Destroy Agent");
  });

  it("has a description", () => {
    const tool = new DestroyAgentTool(null);
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters", () => {
    const tool = new DestroyAgentTool(null);
    expect(tool.parameters).toBeDefined();
  });

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new DestroyAgentTool(null);
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
    let tool: DestroyAgentTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new DestroyAgentTool(client as never);
    });

    it("sends request and returns destroyed status", async () => {
      client.request.mockResolvedValue({ status: "destroyed" });

      const result = await tool.execute("call-1", { agentId: "agent-1" }, undefined);

      expect(client.request).toHaveBeenCalledWith(
        "destroy_agent",
        {
          agentId: "agent-1",
        },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ status: "destroyed" }, null, 2) }],
        details: { status: "destroyed" },
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

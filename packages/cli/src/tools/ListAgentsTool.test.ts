import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";

import { makeMockSocketClient } from "../test-utils";
import { ListAgentsTool } from "./ListAgentsTool";

const mockCtx = {} as ExtensionContext;

describe("ListAgentsTool", () => {
  it("has name 'list_agents'", () => {
    const tool = new ListAgentsTool(null);
    expect(tool.name).toBe("list_agents");
  });

  it("has a label", () => {
    const tool = new ListAgentsTool(null);
    expect(tool.label).toBe("List Agents");
  });

  it("has a description", () => {
    const tool = new ListAgentsTool(null);
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters", () => {
    const tool = new ListAgentsTool(null);
    expect(tool.parameters).toBeDefined();
  });

  describe("without socket client", () => {
    it("returns not-available error", async () => {
      const tool = new ListAgentsTool(null);
      const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);
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
    let tool: ListAgentsTool;

    beforeEach(() => {
      client = makeMockSocketClient();
      tool = new ListAgentsTool(client as never);
    });

    it("sends request and returns agent list", async () => {
      const agents = [
        { agentId: "agent-1", role: "researcher", status: "Running" },
        { agentId: "agent-2", role: "reviewer", status: "Completed" },
      ];
      client.request.mockResolvedValue({ agents });

      const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);

      expect(client.request).toHaveBeenCalledWith("list_agents", {}, undefined, undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ agents }, null, 2) }],
        details: { agents },
      });
    });

    it("returns empty list when no agents", async () => {
      client.request.mockResolvedValue({ agents: [] });

      const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ agents: [] }, null, 2) }],
        details: { agents: [] },
      });
    });

    it("wraps IPC errors", async () => {
      client.request.mockRejectedValue(new Error("Connection lost"));

      const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Connection lost" }) }],
        details: { error: "Connection lost" },
      });
    });

    it("wraps non-Error rejections", async () => {
      client.request.mockRejectedValue("string error");

      const result = await tool.execute("call-1", {}, undefined, undefined, mockCtx);

      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });

    it("throws AbortError when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        tool.execute("call-1", {}, controller.signal, undefined, mockCtx),
      ).rejects.toThrow(DOMException);
      expect(client.request).not.toHaveBeenCalled();
    });
  });
});

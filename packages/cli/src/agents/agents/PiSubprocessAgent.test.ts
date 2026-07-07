import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create the mock before vi.mock factory runs
const { MockRpcClient, getRpcMock, resetRpcMock } = vi.hoisted(() => {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      promptAndWait: vi.fn().mockResolvedValue([]),
      abort: vi.fn().mockResolvedValue(undefined),
    };
  }
  reset();

  function MockRpcClientConstructor() {
    return instance;
  }

  return {
    MockRpcClient: MockRpcClientConstructor,
    getRpcMock: () => instance,
    resetRpcMock: reset,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  RpcClient: MockRpcClient,
  ExtensionAPI: class {},
  ExtensionCommandContext: class {},
  ExtensionContext: class {},
}));

import { AgentStatus } from "@feature-forge/shared";

import { makeMessageEvent, makeSpec } from "../../test-utils";
import { PiSubprocessAgent } from "./PiSubprocessAgent";

describe("PiSubprocessAgent", () => {
  let agent: PiSubprocessAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    // After clearAllMocks, all vi.fn() are reset, so we need fresh ones
    resetRpcMock();

    const spec = makeSpec("test-agent", { role: "tester", systemPrompt: "You are a test." });
    const rpcClient = new (MockRpcClient as unknown as new () => never)();
    agent = new PiSubprocessAgent("test-agent", spec, rpcClient);
  });

  describe("initial state", () => {
    it("starts in Spawned status", () => {
      expect(agent.status).toBe(AgentStatus.Spawned);
    });

    it("has correct id", () => {
      expect(agent.id).toBe("test-agent");
    });
  });

  describe("start", () => {
    it("transitions to Running on successful start", async () => {
      await agent.start();
      expect(agent.status).toBe(AgentStatus.Running);
      expect(getRpcMock().start).toHaveBeenCalledTimes(1);
    });

    it("transitions to Failed and throws when start fails", async () => {
      getRpcMock().start.mockRejectedValueOnce(new Error("Start failed"));
      await expect(agent.start()).rejects.toThrow("Start failed");
      expect(agent.status).toBe(AgentStatus.Failed);
    });

    it("transitions to Failed with non-Error cause", async () => {
      getRpcMock().start.mockRejectedValueOnce("just a string");
      await expect(agent.start()).rejects.toThrow("just a string");
      expect(agent.status).toBe(AgentStatus.Failed);
    });
  });

  describe("executeTask", () => {
    it("throws error if agent is not Running", async () => {
      await expect(agent.executeTask("do something")).rejects.toThrow(
        'Cannot execute task on agent "test-agent" in state "Spawned"',
      );
    });

    it("executes task successfully and extracts assistant text", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([makeMessageEvent("Here are the results.")]);
      const result = await agent.executeTask("research topic");
      expect(result).toBe("Here are the results.");
      expect(agent.status).toBe(AgentStatus.Completed);
    });

    it("extracts text from multiple assistant messages", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Part one." },
              { type: "text", text: "Part two." },
            ],
          },
        },
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Final part." }],
          },
        },
      ]);
      const result = await agent.executeTask("multi");
      expect(result).toBe("Part one.\n\nPart two.\n\nFinal part.");
    });

    it("skips non-text content blocks", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", id: "call1" },
              { type: "text", text: "Only text." },
            ],
          },
        },
      ]);
      const result = await agent.executeTask("filtered");
      expect(result).toBe("Only text.");
    });

    it("handles empty content gracefully", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([]);
      const result = await agent.executeTask("empty");
      expect(result).toBe("");
    });

    it("skips text blocks with empty text", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([
        {
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "text" }, // no text field
              { type: "text", text: "" }, // empty text
              { type: "text", text: "Valid" },
            ],
          },
        },
      ]);
      const result = await agent.executeTask("empty-blocks");
      expect(result).toBe("Valid");
    });

    it("filters events by type and role and content presence", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([
        {
          type: "message_start",
          message: { role: "assistant", content: [{ type: "text", text: "should skip" }] },
        },
        {
          type: "message_end",
          message: { role: "user", content: [{ type: "text", text: "should skip" }] },
        },
        { type: "message_end", message: { role: "assistant" } }, // no content
        {
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "only this" }] },
        },
      ]);
      const result = await agent.executeTask("filter-events");
      expect(result).toBe("only this");
    });

    it("transitions to Failed when task throws with non-Error", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockRejectedValueOnce("string error");
      await expect(agent.executeTask("fail-str")).rejects.toThrow("string error");
      expect(agent.status).toBe(AgentStatus.Failed);
    });

    it("throws AbortError when signal is already aborted before task execution", async () => {
      await agent.start();
      const controller = new AbortController();
      controller.abort();

      await expect(
        agent.executeTask("should-abort", { signal: controller.signal }),
      ).rejects.toThrow(DOMException);
      expect(getRpcMock().promptAndWait).not.toHaveBeenCalled();
    });

    it("calls rpcClient.abort when signal fires mid-execution", async () => {
      await agent.start();
      const controller = new AbortController();

      // promptAndWait rejects when abort fires, simulating the RPC terminating.
      getRpcMock().promptAndWait.mockImplementationOnce(() => {
        controller.abort();
        throw new DOMException("The operation was aborted", "AbortError");
      });

      await expect(agent.executeTask("long-task", { signal: controller.signal })).rejects.toThrow(
        "The operation was aborted",
      );
      expect(getRpcMock().abort).toHaveBeenCalledTimes(1);
      expect(agent.status).toBe(AgentStatus.Failed);
    });

    it("transitions to Failed when task throws", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockRejectedValueOnce(new Error("Task error"));
      await expect(agent.executeTask("fail")).rejects.toThrow("Task error");
      expect(agent.status).toBe(AgentStatus.Failed);
    });
  });

  describe("destroy", () => {
    it("stops RPC client and transitions to Cancelled", async () => {
      await agent.start();
      await agent.destroy();
      expect(getRpcMock().stop).toHaveBeenCalledTimes(1);
      expect(agent.status).toBe(AgentStatus.Cancelled);
    });

    it("swallows stop errors", async () => {
      getRpcMock().stop.mockRejectedValueOnce(new Error("Stop failed"));
      await agent.destroy();
      expect(agent.status).toBe(AgentStatus.Cancelled);
    });
  });

  describe("getResult", () => {
    it("returns result when Completed", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockResolvedValueOnce([makeMessageEvent("Success!")]);
      await agent.executeTask("test");
      expect(agent.getResult()).toBe("Success!");
    });

    it("throws when not Completed", () => {
      expect(() => agent.getResult()).toThrow('Agent "test-agent" is not in Completed state');
    });
  });

  describe("getError", () => {
    it("throws when agent is not Failed or Cancelled", () => {
      expect(() => agent.getError()).toThrow(
        'Agent "test-agent" is not in Failed or Cancelled state',
      );
    });

    it("returns error when Failed", async () => {
      await agent.start();
      getRpcMock().promptAndWait.mockRejectedValueOnce(new Error("boom"));
      try {
        await agent.executeTask("fail");
      } catch {
        /* expected */
      }
      expect(agent.getError()).toBeInstanceOf(Error);
      expect(agent.getError()!.message).toBe("boom");
    });

    it("returns undefined error when Cancelled", async () => {
      await agent.destroy();
      expect(agent.getError()).toBeUndefined();
    });
  });

  describe("deliverResult", () => {
    it("sends formatted success message via pi", () => {
      const pi = { sendMessage: vi.fn() };
      agent.deliverResult("my task", "Findings here", pi as never);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        {
          customType: "tester_result",
          content: "## Tester: my task\n\nFindings here",
          display: true,
        },
        { triggerTurn: false },
      );
    });

    it("handles empty result gracefully", () => {
      const pi = { sendMessage: vi.fn() };
      agent.deliverResult("empty task", "", pi as never);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("_(no findings produced)_") }),
        expect.any(Object),
      );
    });
  });

  describe("deliverError", () => {
    it("sends formatted error message via pi", () => {
      const pi = { sendMessage: vi.fn() };
      agent.deliverError("bad task", new Error("Something broke"), pi as never);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        {
          customType: "tester_error",
          content: "## ❌ Tester failed: bad task\n\nSomething broke",
          display: true,
        },
        { triggerTurn: false },
      );
    });
  });
});

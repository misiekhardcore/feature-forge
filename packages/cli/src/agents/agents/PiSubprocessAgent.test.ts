import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeConfig } from "../../config";

const { onEventCallbacks, fireEvent } = vi.hoisted(() => {
  const callbacks: Array<(event: unknown) => void> = [];
  return {
    onEventCallbacks: callbacks,
    fireEvent: (event: unknown) => {
      callbacks[0]?.(event);
    },
  };
});

const { MockRpcClient, getRpcMock, resetRpcMock } = vi.hoisted(() => {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    onEventCallbacks.length = 0;
    const fakeOnEvent = vi.fn().mockImplementation((cb: (event: unknown) => void) => {
      onEventCallbacks.push(cb);
      return vi.fn(); // unsubscribe function
    });
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      onEvent: fakeOnEvent,
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
import { getDefaultTaskTimeoutMs, PiSubprocessAgent } from "./PiSubprocessAgent";

describe("PiSubprocessAgent", () => {
  let agent: PiSubprocessAgent;

  beforeEach(() => {
    vi.clearAllMocks();
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
      const resultPromise = agent.executeTask("research topic");
      fireEvent(makeMessageEvent("Here are the results."));
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("Here are the results.");
      expect(agent.status).toBe(AgentStatus.Completed);
    });

    it("extracts text from multiple assistant messages", async () => {
      await agent.start();
      const resultPromise = agent.executeTask("multi");
      fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Part one." },
            { type: "text", text: "Part two." },
          ],
        },
      });
      fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final part." }],
        },
      });
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("Part one.\n\nPart two.\n\nFinal part.");
    });

    it("skips non-text content blocks", async () => {
      await agent.start();
      const resultPromise = agent.executeTask("filtered");
      fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "call1" },
            { type: "text", text: "Only text." },
          ],
        },
      });
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("Only text.");
    });

    it("handles empty content gracefully (no events before agent_end)", async () => {
      await agent.start();
      const resultPromise = agent.executeTask("empty");
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("");
    });

    it("skips text blocks with empty text", async () => {
      await agent.start();
      const resultPromise = agent.executeTask("empty-blocks");
      fireEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text" }, { type: "text", text: "" }, { type: "text", text: "Valid" }],
        },
      });
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("Valid");
    });

    it("filters events by type and role and content presence", async () => {
      await agent.start();
      const resultPromise = agent.executeTask("filter-events");
      fireEvent({
        type: "message_start",
        message: { role: "assistant", content: [{ type: "text", text: "should skip" }] },
      });
      fireEvent({
        type: "message_end",
        message: { role: "user", content: [{ type: "text", text: "should skip" }] },
      });
      fireEvent({ type: "message_end", message: { role: "assistant" } });
      fireEvent({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "only this" }] },
      });
      fireEvent({ type: "agent_end" });
      const result = await resultPromise;
      expect(result).toBe("only this");
    });

    it("transitions to Failed when task throws with non-Error", async () => {
      await agent.start();
      getRpcMock().prompt.mockRejectedValueOnce("string error");
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
      expect(getRpcMock().prompt).not.toHaveBeenCalled();
    });

    it("calls rpcClient.abort when signal fires mid-execution", async () => {
      await agent.start();
      const controller = new AbortController();
      getRpcMock().prompt.mockImplementationOnce(() => {
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
      getRpcMock().prompt.mockRejectedValueOnce(new Error("Task error"));
      await expect(agent.executeTask("fail")).rejects.toThrow("Task error");
      expect(agent.status).toBe(AgentStatus.Failed);
    });

    describe("streaming (prompt + onEvent)", () => {
      it("subscribes to onEvent when options.onEvent is provided", async () => {
        await agent.start();
        const callback = vi.fn();
        const resultPromise = agent.executeTask("stream", { onEvent: callback });
        fireEvent({ type: "agent_end" });
        await resultPromise;
        expect(getRpcMock().onEvent).toHaveBeenCalledTimes(2);
      });

      it("does not subscribe external onEvent when no callback provided", async () => {
        await agent.start();
        const resultPromise = agent.executeTask("no-callback");
        fireEvent({ type: "agent_end" });
        await resultPromise;
        expect(getRpcMock().onEvent).toHaveBeenCalledTimes(1);
        expect(getRpcMock().prompt).toHaveBeenCalledWith("no-callback", undefined);
      });

      it("subscribes external callback before calling prompt", async () => {
        await agent.start();
        const callback = vi.fn();
        const resultPromise = agent.executeTask("order", { onEvent: callback });
        const onEventSpy = getRpcMock().onEvent;
        const promptSpy = getRpcMock().prompt;
        fireEvent({ type: "agent_end" });
        await resultPromise;
        const onEventCallIndex = onEventSpy.mock.invocationCallOrder[0];
        const promptCallIndex = promptSpy.mock.invocationCallOrder[0];
        expect(onEventCallIndex).toBeLessThan(promptCallIndex);
      });

      it("calls prompt with the message and images", async () => {
        await agent.start();
        const imageContent = { type: "image" as const, data: "abc", mimeType: "image/png" };
        const resultPromise = agent.executeTask("hello", { images: [imageContent] });
        fireEvent({ type: "agent_end" });
        await resultPromise;
        expect(getRpcMock().prompt).toHaveBeenCalledWith("hello", [imageContent]);
      });

      it("unsubscribes after successful execution", async () => {
        await agent.start();
        const callback = vi.fn();
        const resultPromise = agent.executeTask("stream", { onEvent: callback });
        fireEvent({ type: "agent_end" });
        await resultPromise;
        expect(getRpcMock().onEvent).toHaveBeenCalledTimes(2);
      });

      it("unsubscribes after failed execution", async () => {
        await agent.start();
        const callback = vi.fn();
        getRpcMock().prompt.mockRejectedValueOnce(new Error("boom"));
        await expect(agent.executeTask("fail-stream", { onEvent: callback })).rejects.toThrow(
          "boom",
        );
        expect(getRpcMock().onEvent).toHaveBeenCalledTimes(2);
      });

      it("unsubscribes when prompt rejects with onEvent listeners already active", async () => {
        await agent.start();
        const callback = vi.fn();
        getRpcMock().prompt.mockRejectedValueOnce(new Error("prompt failed"));
        await expect(agent.executeTask("prompt-fail", { onEvent: callback })).rejects.toThrow(
          "prompt failed",
        );
        expect(agent.status).toBe(AgentStatus.Failed);
        expect(getRpcMock().onEvent).toHaveBeenCalledTimes(2);
      });

      it("onEvent is subscribed before prompt is sent", async () => {
        await agent.start();
        const resultPromise = agent.executeTask("order-check");
        const onEventSpy = getRpcMock().onEvent;
        const promptSpy = getRpcMock().prompt;
        fireEvent({ type: "agent_end" });
        await resultPromise;
        const onEventCallIndex = onEventSpy.mock.invocationCallOrder[0];
        const promptCallIndex = promptSpy.mock.invocationCallOrder[0];
        expect(onEventCallIndex).toBeLessThan(promptCallIndex);
      });
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
      const resultPromise = agent.executeTask("test");
      fireEvent(makeMessageEvent("Success!"));
      fireEvent({ type: "agent_end" });
      await resultPromise;
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
      getRpcMock().prompt.mockRejectedValueOnce(new Error("boom"));
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

describe("getDefaultTaskTimeoutMs", () => {
  afterEach(() => {
    ForgeConfig.destroy();
  });

  it("returns timeout from ForgeConfig when initialized", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-timeout-test-"));
    try {
      writeFileSync(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          taskTimeoutMs: 5000,
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });

      const timeout = getDefaultTaskTimeoutMs();
      expect(timeout).toBe(5000);
    } finally {
      ForgeConfig.destroy();
    }
  });

  it("falls back to 1 hour default when ForgeConfig is not initialized", () => {
    ForgeConfig.destroy();

    const timeout = getDefaultTaskTimeoutMs();
    expect(timeout).toBe(60 * 60 * 1000);
  });

  it("uses FORGE_TASK_TIMEOUT_MS env var when ForgeConfig is not initialized", () => {
    ForgeConfig.destroy();
    const original = process.env.FORGE_TASK_TIMEOUT_MS;
    process.env.FORGE_TASK_TIMEOUT_MS = "15000";
    try {
      const timeout = getDefaultTaskTimeoutMs();
      expect(timeout).toBe(15000);
    } finally {
      if (original !== undefined) {
        process.env.FORGE_TASK_TIMEOUT_MS = original;
      } else {
        delete process.env.FORGE_TASK_TIMEOUT_MS;
      }
    }
  });

  it("falls back to 1 hour default when FORGE_TASK_TIMEOUT_MS is invalid", () => {
    ForgeConfig.destroy();
    const original = process.env.FORGE_TASK_TIMEOUT_MS;
    process.env.FORGE_TASK_TIMEOUT_MS = "not-a-number";
    try {
      const timeout = getDefaultTaskTimeoutMs();
      expect(timeout).toBe(60 * 60 * 1000);
    } finally {
      if (original !== undefined) {
        process.env.FORGE_TASK_TIMEOUT_MS = original;
      } else {
        delete process.env.FORGE_TASK_TIMEOUT_MS;
      }
    }
  });
});

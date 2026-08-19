// Test-only value imports from cli: self-heal when cli test-utils
// moves to core (S6) (#229).
import { makeMockTypedEventBus } from "@feature-forge/cli/src/test-utils";
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type { SessionInstruction } from "@feature-forge/core/src/flows/FlowInstruction";
import { FlowStateStore } from "@feature-forge/core/src/flows/FlowStateStore";
import { describe, expect, it, vi } from "vitest";

import { SessionStepExecutor } from "./SessionStepExecutor";

describe("SessionStepExecutor", () => {
  it("has type 'session'", () => {
    const executor = new SessionStepExecutor();
    expect(executor.type).toBe("session");
  });

  it("writes the instruction key and value to context.store", async () => {
    const executor = new SessionStepExecutor();
    const store = new FlowStateStore();

    const instruction: SessionInstruction = {
      type: "session",
      id: "s1",
      key: "base",
      value: "path/to/worktree",
    };
    const context = new FlowContext({
      results: new Map(),
      prompt: "task",
      store,
    });

    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(result.store.get("base")).toBe("path/to/worktree");
  });

  it("returns a new context with the same results, workspaces, and prompt", async () => {
    const executor = new SessionStepExecutor();
    const store = new FlowStateStore();

    const instruction: SessionInstruction = {
      type: "session",
      id: "s1",
      key: "branch",
      value: "feature/x",
    };
    const context = new FlowContext({
      results: new Map([["prev", { raw: "done" }]]),
      prompt: "original prompt",
      store,
      params: new Map([["param1", "value1"]]),
    });

    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(result.results.get("prev")?.raw).toBe("done");
    expect(result.prompt).toBe("original prompt");
    expect(result.params.get("param1")).toBe("value1");
    expect(result.store.get("branch")).toBe("feature/x");
  });

  it("resolves template placeholders in key and value against the context", async () => {
    const executor = new SessionStepExecutor();
    const store = new FlowStateStore();

    const instruction: SessionInstruction = {
      type: "session",
      id: "s1",
      key: "{{paramKey}}",
      value: "{{paramValue}}",
    };
    const context = new FlowContext({
      results: new Map(),
      prompt: "task",
      store,
      params: new Map([
        ["paramKey", "base"],
        ["paramValue", "main"],
      ]),
    });

    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(result.store.get("base")).toBe("main");
  });

  it("resolves session. prefix in value so routines can read persisted state", async () => {
    const executor = new SessionStepExecutor();
    const store = new FlowStateStore();
    store.set("ws", "/tmp/existing");

    const instruction: SessionInstruction = {
      type: "session",
      id: "s1",
      key: "copied",
      value: "{{session.ws}}",
    };
    const context = new FlowContext({
      results: new Map(),
      prompt: "task",
      store,
    });

    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(result.store.get("copied")).toBe("/tmp/existing");
  });

  it("writes to the shared store so subsequent reads see the value", async () => {
    const executor = new SessionStepExecutor();
    const store = new FlowStateStore();

    const instruction1: SessionInstruction = {
      type: "session",
      id: "s1",
      key: "ws",
      value: "/tmp/ws1",
    };
    const instruction2: SessionInstruction = {
      type: "session",
      id: "s2",
      key: "ref",
      value: "main",
    };

    const context = new FlowContext({
      results: new Map(),
      prompt: "task",
      store,
    });

    const result1 = await executor.execute(instruction1, context, vi.fn(), makeMockTypedEventBus());
    const result2 = await executor.execute(instruction2, result1, vi.fn(), makeMockTypedEventBus());

    expect(result2.store.get("ws")).toBe("/tmp/ws1");
    expect(result2.store.get("ref")).toBe("main");
  });

  describe("execute events", () => {
    it("emits feature-forge:session-set event after writing to store", async () => {
      const executor = new SessionStepExecutor();
      const store = new FlowStateStore();

      const instruction: SessionInstruction = {
        type: "session",
        id: "s1",
        key: "ws",
        value: "/tmp/forge-ws",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task", store });

      const eventBus = makeMockTypedEventBus();
      await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(eventBus.raw.emit).toHaveBeenCalledWith(
        "feature-forge:session-set",
        expect.objectContaining({
          phase: "session-set",
          message: "Session param set: ws: /tmp/forge-ws",
          details: { key: "ws", value: "/tmp/forge-ws" },
        }),
      );
    });
  });
});

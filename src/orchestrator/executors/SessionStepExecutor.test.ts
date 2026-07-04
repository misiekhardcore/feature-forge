import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { SessionInstruction } from "../FlowInstruction";
import { FlowStateStore } from "../FlowStateStore";
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

    const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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

    const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

    expect(result.results.get("prev")?.raw).toBe("done");
    expect(result.prompt).toBe("original prompt");
    expect(result.params.get("param1")).toBe("value1");
    expect(result.store.get("branch")).toBe("feature/x");
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

    const result1 = await executor.execute(instruction1, context, vi.fn(), makeMockEventBus());
    const result2 = await executor.execute(instruction2, result1, vi.fn(), makeMockEventBus());

    expect(result2.store.get("ws")).toBe("/tmp/ws1");
    expect(result2.store.get("ref")).toBe("main");
  });
});

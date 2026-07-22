import type { DisplayContribution } from "@feature-forge/tui";
import { createAccumulatedState } from "@feature-forge/tui";
import { DisplayContributionRegistry } from "@feature-forge/tui";
import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { SessionInstruction } from "../FlowInstruction";
import { FlowStateStore } from "../FlowStateStore";
import type { RoutineProgressEvent } from "../RoutineProgress";
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

  describe("getDisplayContribution", () => {
    it("returns SessionContribution for session-set events", () => {
      const executor = new SessionStepExecutor();

      const event = {
        phase: "session-set",
        message: "Session param set: ws: /tmp/forge-ws",
        details: { key: "ws", value: "/tmp/forge-ws" },
      } as unknown as RoutineProgressEvent;

      const contribution = executor.getDisplayContribution(event);

      expect(contribution).toBeDefined();
      expect(contribution!.type).toBe("session");
      expect(contribution!.phase).toBe("session-set");
      expect(contribution!.message).toBe("Session param set: ws: /tmp/forge-ws");
      const sessionContrib = contribution! as DisplayContribution & {
        params: Record<string, string>;
      };
      expect(sessionContrib.params).toEqual({ ws: "/tmp/forge-ws" });
    });

    it("returns undefined for non-session-set events", () => {
      const executor = new SessionStepExecutor();

      const event = {
        phase: "agent-started",
        message: "Agent started",
        details: { executionId: "e1", agentId: "a1" },
      } as unknown as RoutineProgressEvent;

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });
  });

  describe("registerDisplayHandler", () => {
    it("accumulates resultSnippet across multiple session contributions", () => {
      const executor = new SessionStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();

      // Simulate production: getDisplayContribution produces one single-key
      // contribution per event, so multiple session params arrive as separate
      // contributions.
      registry.apply(state, [
        {
          type: "session",
          params: { ws: "/tmp/forge-ws" },
          phase: "session-set",
          message: "Session param set",
        },
        {
          type: "session",
          params: { branch: "forge/ws-abc" },
          phase: "session-set",
          message: "Session param set",
        },
      ]);

      expect(state.resultSnippet).toBe("ws: /tmp/forge-ws, branch: forge/ws-abc");
    });

    it("populates resultSnippet with single param", () => {
      const executor = new SessionStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      const contribution: DisplayContribution = {
        type: "session",
        params: { base_branch: "main" },
        phase: "session-set",
        message: "Session param set",
      };

      registry.apply(state, [contribution]);

      expect(state.resultSnippet).toBe("base_branch: main");
    });

    it("round-trip: getDisplayContribution → handler → resultSnippet", () => {
      const executor = new SessionStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      // Simulate two events as produced by execute()
      const event1 = {
        phase: "session-set",
        message: "Session param set: ws: /tmp/forge-ws",
        details: { key: "ws", value: "/tmp/forge-ws" },
      } as unknown as RoutineProgressEvent;

      const event2 = {
        phase: "session-set",
        message: "Session param set: branch: forge/ws-abc",
        details: { key: "branch", value: "forge/ws-abc" },
      } as unknown as RoutineProgressEvent;

      const contrib1 = executor.getDisplayContribution(event1);
      const contrib2 = executor.getDisplayContribution(event2);

      expect(contrib1).toBeDefined();
      expect(contrib2).toBeDefined();

      const state = createAccumulatedState();
      registry.apply(state, [contrib1!, contrib2!]);

      expect(state.resultSnippet).toBe("ws: /tmp/forge-ws, branch: forge/ws-abc");
    });
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

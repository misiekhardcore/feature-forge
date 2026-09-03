import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import type { TypedEventBus } from "@feature-forge/core/event-bus";
import type { RoutineResult } from "@feature-forge/core/routines";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { RoutineProgressFeed } from "./RoutineProgressFeed";

/** All channels the feed subscribes to — mirrors PROGRESS_CHANNELS. */
const CHANNELS = [
  "feature-forge:workspace-ready",
  "feature-forge:agent-started",
  "feature-forge:agent-stream",
  "feature-forge:agent-done",
  "feature-forge:loop-round-start",
  "feature-forge:loop-round-complete",
  "feature-forge:parallel-start",
  "feature-forge:parallel-done",
  "feature-forge:cleanup-start",
  "feature-forge:cleanup-done",
  "feature-forge:git-start",
  "feature-forge:git-done",
  "feature-forge:shell-start",
  "feature-forge:shell-done",
  "feature-forge:session-set",
  "feature-forge:routine-ref-start",
  "feature-forge:routine-ref-done",
  "feature-forge:routine-ref-error",
] as const;

function makeFeed(
  overrides: {
    routineName?: string;
    eventBus?: TypedEventBus;
    session?: () => Record<string, unknown>;
    onUpdate?: AgentToolUpdateCallback<RoutineResult>;
    onAgentEvent?: () => void;
    onProgress?: () => void;
    logPayloads?: boolean;
  } = {},
) {
  const eventBus = overrides.eventBus ?? makeMockTypedEventBus();
  const feed = new RoutineProgressFeed({
    routineName: overrides.routineName ?? "build",
    eventBus,
    session: overrides.session ?? (() => ({})),
    onUpdate: overrides.onUpdate,
    onAgentEvent: overrides.onAgentEvent,
    onProgress: overrides.onProgress,
    logPayloads: overrides.logPayloads,
  });
  return { feed, eventBus };
}

/** Agent lifecycle events carrying agentId (agent-started/stream/done). */
function agentEvents() {
  return {
    started: {
      phase: "agent-started",
      message: 'Agent "builder" (build) started',
      details: { executionId: "exec-1", agentId: "builder" },
    },
    done: {
      phase: "agent-done",
      message: 'Agent "builder" (build) completed',
      details: {
        executionId: "exec-1",
        agentId: "builder",
        passed: true,
        summary: "All OK",
      },
    },
  } as const;
}

describe("RoutineProgressFeed", () => {
  describe("subscribe", () => {
    it("registers a listener for every progress channel", () => {
      const { feed, eventBus } = makeFeed();
      const unsubscribe = feed.subscribe();

      for (const channel of CHANNELS) {
        expect(eventBus.raw.on).toHaveBeenCalledWith(channel, expect.any(Function));
      }
      expect(eventBus.raw.on).toHaveBeenCalledTimes(CHANNELS.length);

      unsubscribe();
    });

    it("returns an unsubscribe fn that removes all listeners", () => {
      const onUpdate = vi.fn();
      const onProgress = vi.fn();
      const { feed, eventBus } = makeFeed({ onUpdate, onProgress });

      const unsubscribe = feed.subscribe();
      unsubscribe();

      eventBus.emit("feature-forge:agent-started", agentEvents().started);

      expect(onUpdate).not.toHaveBeenCalled();
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  describe("accumulated state fold", () => {
    it("folds agent-started/agent-done events into the accumulated state", () => {
      const { feed, eventBus } = makeFeed();
      feed.subscribe();

      eventBus.emit("feature-forge:agent-started", agentEvents().started);
      eventBus.emit("feature-forge:agent-done", agentEvents().done);

      const acc = feed.accumulatedState;
      expect(acc.agentMap.has("builder")).toBe(true);
      expect(acc.agentMap.get("builder")?.status).toBe("done");
      expect(acc.agentMap.get("builder")?.summary).toBe("All OK");
    });

    it("folds workspace-ready and loop-round-complete events", () => {
      const { feed, eventBus } = makeFeed();
      feed.subscribe();

      eventBus.emit("feature-forge:workspace-ready", {
        phase: "workspace-ready",
        message: "Workspace ready",
        details: { path: "/tmp/ws-1", branch: "feature/foo" },
      });
      eventBus.emit("feature-forge:loop-round-complete", {
        phase: "loop-round-complete",
        message: "Loop round complete",
        details: { round: 2, maxIterations: 3, continueWhile: "result.passed" },
      });

      const acc = feed.accumulatedState;
      expect(acc.workspace).toBe("/tmp/ws-1");
      expect(acc.branch).toBe("feature/foo");
      expect(acc.iteration).toBe(1);
      expect(acc.maxIterations).toBe(3);
      expect(acc.continueWhile).toBe("result.passed");
    });
  });

  describe("reset and re-subscribe", () => {
    it("reset replaces the accumulated state with a fresh empty one", () => {
      const { feed, eventBus } = makeFeed();
      feed.subscribe();

      eventBus.emit("feature-forge:agent-started", agentEvents().started);
      expect(feed.accumulatedState.agentMap.size).toBe(1);
      const before = feed.accumulatedState;

      feed.reset();
      expect(feed.accumulatedState.agentMap.size).toBe(0);
      expect(feed.accumulatedState).not.toBe(before);
    });

    it("re-subscribing on the same instance resets state (execution isolation)", () => {
      const { feed, eventBus } = makeFeed();
      const unsubscribe = feed.subscribe();

      eventBus.emit("feature-forge:agent-started", agentEvents().started);
      expect(feed.accumulatedState.agentMap.size).toBe(1);

      unsubscribe();
      feed.subscribe();
      expect(feed.accumulatedState.agentMap.size).toBe(0);
      expect(feed.accumulatedState.workspace).toBeUndefined();
    });
  });

  describe("onUpdate details", () => {
    it("falls back to options.routineName with defaults for missing fields", () => {
      const onUpdate = vi.fn();
      const session = { key: "value" };
      const { feed, eventBus } = makeFeed({
        routineName: "build",
        onUpdate,
        session: () => session,
      });
      feed.subscribe();

      eventBus.emit("feature-forge:workspace-ready", {
        phase: "workspace-ready",
        message: "Workspace ready",
        details: { path: "/tmp/ws-1", branch: "main" },
      });

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const details = onUpdate.mock.calls[0][0].details;
      expect(details.routine).toBe("build");
      expect(details.passed).toBe(false);
      expect(details.status).toBe("success");
      expect(details.rounds).toBe(0);
      expect(details.results).toEqual({});
      expect(details.summary).toBe("");
      expect(details.session).toBe(session);
    });

    it("uses event.details.routine when present", () => {
      const onUpdate = vi.fn();
      const { feed, eventBus } = makeFeed({ onUpdate });
      feed.subscribe();

      // No forge channel declares `routine` in its details — emit via the raw
      // bus to exercise the defensive `details.routine` fallback path.
      eventBus.raw.emit("feature-forge:shell-done", {
        phase: "shell-done",
        message: "Shell done",
        details: { passed: true, summary: "ok", routine: "custom-routine" },
      });

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0].details.routine).toBe("custom-routine");
    });
  });

  describe("callbacks", () => {
    it("invokes onAgentEvent only for events carrying agentId", () => {
      const onAgentEvent = vi.fn();
      const { feed, eventBus } = makeFeed({ onAgentEvent });
      feed.subscribe();

      eventBus.emit("feature-forge:workspace-ready", {
        phase: "workspace-ready",
        message: "Workspace ready",
        details: { path: "/tmp/ws-1", branch: "main" },
      });
      eventBus.emit("feature-forge:agent-started", agentEvents().started);
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: "stream chunk",
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: { type: "agent_start" },
        },
      });
      eventBus.emit("feature-forge:agent-done", agentEvents().done);

      expect(onAgentEvent).toHaveBeenCalledTimes(3);
    });

    it("invokes onProgress per event after the fold", () => {
      const onProgress = vi.fn();
      const { feed, eventBus } = makeFeed({ onProgress });
      feed.subscribe();

      eventBus.emit("feature-forge:agent-started", agentEvents().started);
      eventBus.emit("feature-forge:workspace-ready", {
        phase: "workspace-ready",
        message: "Workspace ready",
        details: { path: "/tmp/ws-1", branch: "main" },
      });

      expect(onProgress).toHaveBeenCalledTimes(2);
      // The fold has already happened when onProgress fires.
      expect(feed.accumulatedState.agentMap.has("builder")).toBe(true);
    });
  });

  describe("debug logging", () => {
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
      debugSpy.mockRestore();
    });

    it("logs the full event payload when logPayloads is enabled", () => {
      const { feed, eventBus } = makeFeed({ logPayloads: true });
      feed.subscribe();

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: { type: "agent_start" },
        },
      });

      expect(debugSpy).toHaveBeenCalledWith("RoutineTool progress", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: { type: "agent_start" },
        },
      });
    });

    it("logs only phase and message when logPayloads is disabled", () => {
      const { feed, eventBus } = makeFeed({ logPayloads: false });
      feed.subscribe();

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: { type: "agent_start" },
        },
      });

      expect(debugSpy).toHaveBeenCalledWith("RoutineTool progress", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
      });
      expect(debugSpy).not.toHaveBeenCalledWith(
        "RoutineTool progress",
        expect.objectContaining({ details: expect.anything() }),
      );
    });

    it("logs only phase and message when logPayloads is absent (default off)", () => {
      const { feed, eventBus } = makeFeed();
      feed.subscribe();

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: { type: "agent_start" },
        },
      });

      expect(debugSpy).toHaveBeenCalledWith("RoutineTool progress", {
        phase: "agent-stream",
        message: 'tool_call: read("file.ts")',
      });
      expect(debugSpy).not.toHaveBeenCalledWith(
        "RoutineTool progress",
        expect.objectContaining({ details: expect.anything() }),
      );
    });
  });
});

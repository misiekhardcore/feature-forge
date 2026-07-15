import { afterEach, describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { FLOW_SCHEMA_URL } from "../FlowInstruction";
import { MaxDepthExceededError } from "../MaxDepthExceededError";
import { createAccumulatedState } from "../progress/AccumulatedState";
import { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import { RoutineExecutor } from "../RoutineExecutor";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { RoutineRefLookupError, RoutineRefStepExecutor } from "./RoutineRefStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Create a minimal flow definition with a single routine.
 */
function makeFlow(
  name: string,
  command: string,
  routineSteps: FlowInstruction[] = [],
): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name,
    command,
    orchestrator: { systemPrompt: "You are a test orchestrator." },
    routines: {
      main: {
        params: [],
        steps: routineSteps,
      },
    },
  };
}

/**
 * Create a RoutineRefInstruction with sensible defaults.
 */
function makeInstruction(overrides: Partial<RoutineRefInstruction> = {}): RoutineRefInstruction {
  return {
    type: "routine",
    id: "ref1",
    target: "/implement",
    routine: "main",
    ...overrides,
  };
}

/**
 * Create a RoutineRefStepExecutor with a flowMap containing the given flows.
 */
function createExecutor(flowMap: Map<string, FlowDefinition>): RoutineRefStepExecutor {
  const stepRegistry = new StepExecutorRegistry();
  return new RoutineRefStepExecutor({ flowMap, stepRegistry });
}

describe("RoutineRefStepExecutor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("type", () => {
    it("has type 'routine'", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      expect(executor.type).toBe("routine");
    });
  });

  describe("execute", () => {
    it("throws MaxDepthExceededError when depth exceeds MAX_NESTING_DEPTH", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction();
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: MaxDepthExceededError.MAX_NESTING_DEPTH,
      });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow(MaxDepthExceededError);
    });

    it("emits routine-ref-error when depth exceeds MAX_NESTING_DEPTH", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction();
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: MaxDepthExceededError.MAX_NESTING_DEPTH,
      });
      const eventBus = makeMockTypedEventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");

      await expect(executor.execute(instruction, context, vi.fn(), eventBus)).rejects.toThrow(
        MaxDepthExceededError,
      );

      expect(emitSpy).toHaveBeenCalledWith("feature-forge:routine-ref-error", {
        phase: "routine-ref-error",
        message: expect.stringContaining("exceeds maximum"),
        details: {
          instructionId: "ref1",
          target: "/implement",
          routine: "main",
        },
      });
    });

    it("throws RoutineRefLookupError for a missing target flow", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction();
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow(RoutineRefLookupError);
    });

    it("returns a failed result when on_error is 'continue' and target flow is missing", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ on_error: "continue" });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const output = result.results.get("ref1");
      expect(output).toBeDefined();
      expect(output!.parsed?.passed).toBe(false);
      expect(output!.parsed?.summary).toContain("not found");
    });

    it("throws RoutineRefLookupError for a missing target routine", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ routine: "nonexistent" });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow(RoutineRefLookupError);
    });

    it("returns a failed result when on_error is 'continue' and target routine is missing", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ routine: "nonexistent", on_error: "continue" });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const output = result.results.get("ref1");
      expect(output).toBeDefined();
      expect(output!.parsed?.passed).toBe(false);
      expect(output!.parsed?.summary).toContain("not found");
    });

    it("emits routine-ref-start before executing the target routine", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction();
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const eventBus = makeMockTypedEventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");

      const result = await executor.execute(instruction, context, vi.fn(), eventBus);

      // routine-ref-start should have been emitted
      expect(emitSpy).toHaveBeenCalledWith("feature-forge:routine-ref-start", {
        phase: "routine-ref-start",
        message: expect.stringContaining("Referencing"),
        details: {
          instructionId: "ref1",
          target: "/implement",
          routine: "main",
        },
      });

      // routine-ref-done should also have been emitted
      expect(emitSpy).toHaveBeenCalledWith("feature-forge:routine-ref-done", {
        phase: "routine-ref-done",
        message: expect.stringContaining("completed"),
        details: {
          instructionId: "ref1",
          target: "/implement",
          routine: "main",
          passed: true,
        },
      });

      // The result should contain the output
      const output = result.results.get("ref1");
      expect(output).toBeDefined();
      expect(output!.parsed?.passed).toBe(true);
    });

    it("stores result under output_as when provided", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ output_as: "my-output-key" });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.has("my-output-key")).toBe(true);
      expect(result.results.has("ref1")).toBe(false);
    });

    it("resolves input params via context.resolve before passing to the routine", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const params = new Map<string, string>([["branch", "feature/my-feature"]]);
      const instruction = makeInstruction({
        input: { branch: "{{branch}}", task: "{{prompt}}" },
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "Build the feature",
        params,
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const output = result.results.get("ref1");
      expect(output).toBeDefined();
      expect(output!.parsed?.passed).toBe(true);
    });

    it("aborts when parent signal is already aborted", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction();
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const abortedSignal = AbortSignal.abort();

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), abortedSignal),
      ).rejects.toThrow();
    });

    it("aborts when instruction timeout elapses", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ timeout: 0.01 });

      // Mock RoutineExecutor.run to never resolve - timeout will trigger abort.
      const runSpy = vi.spyOn(RoutineExecutor.prototype, "run").mockImplementation(
        (_name, _params, _prompt, signal) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
      );

      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow(DOMException);

      runSpy.mockRestore();
    }, 5000);

    it("combines parent and timeout signal, aborting when timeout elapses", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ timeout: 0.01 });

      // Mock RoutineExecutor.run to never resolve - timeout will trigger abort.
      const runSpy = vi.spyOn(RoutineExecutor.prototype, "run").mockImplementation(
        (_name, _params, _prompt, signal) =>
          new Promise((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
            signal?.addEventListener("abort", onAbort, { once: true });
          }),
      );

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const parentSignal = new AbortController().signal; // not pre-aborted

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), parentSignal),
      ).rejects.toThrow(DOMException);

      runSpy.mockRestore();
    }, 5000);

    it("throws a runtime error when on_error defaults to fail and RoutineExecutor.run() throws", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction(); // no on_error — defaults to fail

      const runError = new Error("Internal routine failure");
      vi.spyOn(RoutineExecutor.prototype, "run").mockRejectedValue(runError);

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const eventBus = makeMockTypedEventBus();
      const emitSpy = vi.spyOn(eventBus, "emit");

      await expect(executor.execute(instruction, context, vi.fn(), eventBus)).rejects.toThrow(
        "Internal routine failure",
      );

      expect(emitSpy).toHaveBeenCalledWith("feature-forge:routine-ref-error", {
        phase: "routine-ref-error",
        message: "Internal routine failure",
        details: {
          instructionId: "ref1",
          target: "/implement",
          routine: "main",
        },
      });
    });

    it("returns a failed result when on_error is 'continue' and RoutineExecutor.run() throws", async () => {
      const flowMap = new Map<string, FlowDefinition>();
      flowMap.set("/implement", makeFlow("implement", "/implement", []));
      const executor = createExecutor(flowMap);
      const instruction = makeInstruction({ on_error: "continue" });

      // Mock RoutineExecutor.run to throw a runtime error.
      const runError = new Error("Child routine crashed");
      const runSpy = vi.spyOn(RoutineExecutor.prototype, "run").mockRejectedValue(runError);

      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const output = result.results.get("ref1");
      expect(output).toBeDefined();
      expect(output!.parsed?.passed).toBe(false);
      expect(output!.parsed?.summary).toContain("Child routine crashed");

      runSpy.mockRestore();
    });
  });

  describe("getDisplayContribution", () => {
    it("returns undefined for non-routine-ref events", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);

      const result = executor.getDisplayContribution({
        phase: "agent-started",
        message: "started",
        details: { executionId: "e1", agentId: "a1" },
      });

      expect(result).toBeUndefined();
    });

    it("returns a started contribution for routine-ref-start", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);

      const result = executor.getDisplayContribution({
        phase: "routine-ref-start",
        message: "Starting ref to flow-a/build",
        details: { instructionId: "r1", target: "flow-a", routine: "build" },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "started",
        phase: "routine-ref-start",
        message: "Starting ref to flow-a/build",
      });
    });

    it("returns a done contribution for routine-ref-done", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);

      const result = executor.getDisplayContribution({
        phase: "routine-ref-done",
        message: "Ref to flow-a/build completed",
        details: { instructionId: "r1", target: "flow-a", routine: "build", passed: true },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "done",
        phase: "routine-ref-done",
        message: "Ref to flow-a/build completed",
      });
    });

    it("returns an error contribution for routine-ref-error", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);

      const result = executor.getDisplayContribution({
        phase: "routine-ref-error",
        message: "Ref to flow-a/build failed",
        details: { instructionId: "r1", target: "flow-a", routine: "build" },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "error",
        phase: "routine-ref-error",
        message: "Ref to flow-a/build failed",
      });
    });
  });

  describe("registerDisplayHandler", () => {
    it("appends target:routine to state.routineRefs for routine-ref contributions", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "routine-ref",
          target: "flow-a",
          routine: "build",
          status: "started",
          phase: "routine-ref-start",
          message: "started",
        },
        {
          type: "routine-ref",
          target: "flow-b",
          routine: "review",
          status: "done",
          phase: "routine-ref-done",
          message: "done",
        },
      ]);

      expect(state.routineRefs).toEqual(["flow-a:build", "flow-b:review"]);
    });

    it("initializes routineRefs array when first contribution arrives", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      expect(state.routineRefs).toBeUndefined();

      registry.apply(state, [
        {
          type: "routine-ref",
          target: "flow-a",
          routine: "build",
          status: "started",
          phase: "routine-ref-start",
          message: "started",
        },
      ]);

      expect(state.routineRefs).toEqual(["flow-a:build"]);
    });

    it("ignores non-routine-ref contributions", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "agent",
          agentId: "a1",
          agentStatus: "done",
          phase: "agent-done",
          message: "done",
        },
      ]);

      expect(state.routineRefs).toBeUndefined();
    });

    it("preserves arrival order for routine-ref contributions", () => {
      const flowMap = new Map<string, FlowDefinition>();
      const executor = createExecutor(flowMap);
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "routine-ref",
          target: "x",
          routine: "first",
          status: "started",
          phase: "routine-ref-start",
          message: "first",
        },
        {
          type: "routine-ref",
          target: "y",
          routine: "second",
          status: "done",
          phase: "routine-ref-done",
          message: "second",
        },
        {
          type: "routine-ref",
          target: "z",
          routine: "third",
          status: "started",
          phase: "routine-ref-start",
          message: "third",
        },
      ]);

      expect(state.routineRefs).toEqual(["x:first", "y:second", "z:third"]);
    });
  });
});

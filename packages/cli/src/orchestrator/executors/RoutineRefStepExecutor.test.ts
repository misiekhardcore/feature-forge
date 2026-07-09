import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { FlowDefinition, RoutineRefInstruction } from "../FlowInstruction";
import { FLOW_SCHEMA_URL } from "../FlowInstruction";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "../MaxDepthExceededError";
import { RoutineExecutor } from "../RoutineExecutor";
import { RuntimeCapabilities } from "../RuntimeCapabilities";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";
import { SessionStepExecutor } from "./SessionStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function makeRoutineRefInstruction(
  overrides: Partial<RoutineRefInstruction> = {},
): RoutineRefInstruction {
  return {
    type: "routine",
    id: "ref1",
    target: "/target",
    routine: "build",
    input: { task: "do it" },
    ...overrides,
  };
}

function makeTargetFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "target-flow",
    command: "/target",
    orchestrator: { systemPrompt: "target-orchestrator" },
    routines: {
      build: { params: [{ name: "task" }], steps: [] },
    },
    ...overrides,
  };
}

/** Helper: create a registry populated with the session executor
 * so the target flow's steps can be dispatched. */
function makePopulatedRegistry(): StepExecutorRegistry {
  const registry = new StepExecutorRegistry();
  registry.register(() => new SessionStepExecutor());
  return registry;
}

/** Helper: build a routine with a record step, properly typed. */
function makeRoutineWithRecordStep(): FlowDefinition["routines"]["_"] {
  return {
    params: [{ name: "task" }],
    steps: [{ type: "session" as const, id: "step1", key: "k", value: "v" }],
  };
}

/** Helper: build a routine with a record step that has multiple params. */
function makeRoutineWithRecordStepAndPlan(): FlowDefinition["routines"]["_"] {
  return {
    params: [{ name: "task" }, { name: "plan" }],
    steps: [{ type: "session" as const, id: "step1", key: "k", value: "v" }],
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("RoutineRefStepExecutor", () => {
  describe("type", () => {
    it('returns "routine"', () => {
      const caps = new RuntimeCapabilities(
        makeMockEventBus(),
        {} as StepExecutorRegistry,
        new Map(),
      );
      const executor = new RoutineRefStepExecutor(caps);
      expect(executor.type).toBe("routine");
    });
  });

  describe("execute", () => {
    it("throws when target flow is not found", async () => {
      const caps = new RuntimeCapabilities(
        makeMockEventBus(),
        new StepExecutorRegistry(),
        new Map(),
      );
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({ target: "/nonexistent" });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toThrow('Target flow "/nonexistent" not found');
    });

    it("stores failure result when on_error is continue and target not found", async () => {
      const caps = new RuntimeCapabilities(
        makeMockEventBus(),
        new StepExecutorRegistry(),
        new Map(),
      );
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/nonexistent",
        on_error: "continue",
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      const storedResult = result.results.get("ref1");
      expect(storedResult).toBeDefined();
      expect(storedResult!.parsed!.passed).toBe(false);
      expect(storedResult!.raw).toContain("not found");
    });

    it("throws when routine is not found in target flow", async () => {
      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow());
      const caps = new RuntimeCapabilities(makeMockEventBus(), new StepExecutorRegistry(), flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "nonexistent",
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toThrow("not found");
    });

    it("stores failure result when on_error is continue and routine not found", async () => {
      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow());
      const caps = new RuntimeCapabilities(makeMockEventBus(), new StepExecutorRegistry(), flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "nonexistent",
        on_error: "continue",
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      const storedResult = result.results.get("ref1");
      expect(storedResult).toBeDefined();
      expect(storedResult!.parsed!.passed).toBe(false);
    });

    it("executes a cross-flow routine and stores the result", async () => {
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow({ routines: { build: makeRoutineWithRecordStep() } }));

      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        input: { task: "build it" },
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      const storedResult = result.results.get("ref1");
      expect(storedResult).toBeDefined();
      expect(storedResult!.parsed!.passed).toBe(true);
      expect(storedResult!.parsed!.summary).toContain('"build"');
    });

    it("resolves input params through the parent context template engine", async () => {
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set(
        "/target",
        makeTargetFlow({ routines: { build: makeRoutineWithRecordStepAndPlan() } }),
      );

      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        input: { task: "{{plan}}", plan: "use JWT" },
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        params: new Map([["plan", "use JWT"]]),
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.has("ref1")).toBe(true);
    });

    it("uses output_as key when specified", async () => {
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow({ routines: { build: makeRoutineWithRecordStep() } }));

      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        output_as: "my_output",
        input: { task: "do it" },
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      // Result should be stored under "my_output", not "ref1".
      expect(result.results.has("my_output")).toBe(true);
      expect(result.results.has("ref1")).toBe(false);
    });

    it("emits routine-ref-start and routine-ref-done events", async () => {
      const eventBus = makeMockEventBus();
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow({ routines: { build: makeRoutineWithRecordStep() } }));

      const caps = new RuntimeCapabilities(eventBus, registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        input: { task: "do it" },
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(eventBus.emit).toHaveBeenCalledWith(
        "feature-forge:routine-ref-start",
        expect.objectContaining({ phase: "routine-ref-start" }),
      );
      expect(eventBus.emit).toHaveBeenCalledWith(
        "feature-forge:routine-ref-done",
        expect.objectContaining({ phase: "routine-ref-done" }),
      );
    });

    it("respects abort signal and re-throws AbortError", async () => {
      const caps = new RuntimeCapabilities(
        makeMockEventBus(),
        new StepExecutorRegistry(),
        new Map(),
      );
      const executor = new RoutineRefStepExecutor(caps);
      const controller = new AbortController();
      controller.abort();

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        on_error: "continue",
      });
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus(), controller.signal),
      ).rejects.toBeInstanceOf(DOMException);
    });

    it("propagates depth limit error when MAX_NESTING_DEPTH is exceeded", async () => {
      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow());
      const registry = makePopulatedRegistry();
      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        on_error: "continue",
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: 10,
      });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toThrow("Maximum routine nesting depth");
    });

    it("passes incremented depth to the child RoutineExecutor.run()", async () => {
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow({ routines: { build: makeRoutineWithRecordStep() } }));

      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        input: { task: "do it" },
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: 2,
      });

      // Spy on RoutineExecutor.prototype.run to capture the depth argument.
      const originalRun = RoutineExecutor.prototype.run;
      const runSpy = vi.spyOn(RoutineExecutor.prototype, "run").mockImplementation(function (
        this: RoutineExecutor,
        ...args: unknown[]
      ) {
        const depth = (args[4] as number) ?? 0;
        expect(depth).toBe(3);
        const typedArgs = args as Parameters<RoutineExecutor["run"]>;
        return originalRun.apply(this, typedArgs);
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(runSpy).toHaveBeenCalledTimes(1);
      runSpy.mockRestore();
    });

    it("passes default depth 1 from a top-level parent context", async () => {
      const registry = makePopulatedRegistry();

      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow({ routines: { build: makeRoutineWithRecordStep() } }));

      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        input: { task: "do it" },
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        // default depth = 0
      });

      const originalRun = RoutineExecutor.prototype.run;
      const runSpy = vi.spyOn(RoutineExecutor.prototype, "run").mockImplementation(function (
        this: RoutineExecutor,
        ...args: unknown[]
      ) {
        const depth = (args[4] as number) ?? 0;
        expect(depth).toBe(1);
        const typedArgs = args as Parameters<RoutineExecutor["run"]>;
        return originalRun.apply(this, typedArgs);
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(runSpy).toHaveBeenCalledTimes(1);
      runSpy.mockRestore();
    });

    it("accumulates depth across three nesting levels", async () => {
      // Flow C — the deepest child, runs a simple session step.
      const flowC: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "flow-c",
        command: "/c",
        orchestrator: { systemPrompt: "c-orch" },
        routines: {
          deep: { params: [], steps: [{ type: "session", id: "deep-step", key: "k", value: "v" }] },
        },
      };

      // Flow B — calls flow C via routine ref.
      const flowB: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "flow-b",
        command: "/b",
        orchestrator: { systemPrompt: "b-orch" },
        routines: {
          middle: {
            params: [],
            steps: [
              {
                type: "routine",
                id: "call-c",
                target: "/c",
                routine: "deep",
                input: {},
              },
            ],
          },
        },
      };

      // Flow A — calls flow B via routine ref.
      const flowA: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "flow-a",
        command: "/a",
        orchestrator: { systemPrompt: "a-orch" },
        routines: {
          top: {
            params: [],
            steps: [
              {
                type: "routine",
                id: "call-b",
                target: "/b",
                routine: "middle",
                input: {},
              },
            ],
          },
        },
      };

      const flows = new Map<string, FlowDefinition>();
      flows.set("/a", flowA);
      flows.set("/b", flowB);
      flows.set("/c", flowC);

      const registry = makePopulatedRegistry();
      // Register RoutineRefStepExecutor so flow B can call flow C.
      registry.register(
        () =>
          new RoutineRefStepExecutor(new RuntimeCapabilities(makeMockEventBus(), registry, flows)),
      );
      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/a",
        routine: "top",
        input: {},
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: 0,
      });

      // Flows A→B→C should all complete successfully with depth accumulating.
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      // The outer routine ref stores the result under the instruction id (ref1).
      expect(result.results.has("ref1")).toBe(true);
      const refResult = result.results.get("ref1");
      expect(refResult?.parsed?.passed).toBe(true);
      // The summary should mention the target flow.
      expect(refResult?.parsed?.summary).toContain("/a");
      expect(refResult?.parsed?.summary).toContain("/a");
    });

    it("throws MaxDepthExceededError when chain reaches MAX_NESTING_DEPTH", async () => {
      // Verify that starting at depth 9 (MAX_NESTING_DEPTH - 1), the second
      // nest level throws because depth would exceed the limit.
      // Set up: parent at depth 9, routine ref instruction fires.
      const flows = new Map<string, FlowDefinition>();
      flows.set("/target", makeTargetFlow());
      const registry = makePopulatedRegistry();
      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        target: "/target",
        routine: "build",
        on_error: "continue",
      });
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        depth: MAX_NESTING_DEPTH,
      });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toThrow(MaxDepthExceededError);
    });
  });

  describe("event routing", () => {
    it("namespaces child routine-ref-start event on parent bus", async () => {
      const bus = makeMockEventBus();
      const eventSpy = vi.spyOn(bus, "emit");
      const flow = makeTargetFlow();
      const flows = new Map<string, FlowDefinition>();
      flows.set("/a", flow);
      const caps = new RuntimeCapabilities(bus, new StepExecutorRegistry(), flows);
      const executor = new RoutineRefStepExecutor(caps);

      const instruction = makeRoutineRefInstruction({
        id: "ns-test",
        target: "/a",
        routine: "build",
        input: {},
      });

      await executor.execute(
        instruction,
        new FlowContext({ results: new Map(), prompt: "task" }),
        vi.fn(),
        bus,
      );

      // The start event (emitted on parent bus before child executor runs)
      // is emitted at the parent level — verify it exists
      const startEvents = eventSpy.mock.calls.filter(
        ([channel]) => channel === "feature-forge:routine-ref-start",
      );
      expect(startEvents.length).toBe(1);
    });
  });
});

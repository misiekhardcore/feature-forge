/**
 * **Flow round-trip contract test — drift guardrail.**
 *
 * This single test file would have caught flaws 2, 3, 6, and 10 at load time.
 * It validates every shipped flow in `src/flows/` against the live code:
 *
 * 1. Loads via FlowLoader (structural + semantic validation).
 * 2. Resolves every agent task through FlowContext
 *    and asserts no {{...}} survivors (catch dead/misspelled placeholders).
 * 3. Asserts every agent.systemPrompt is in the set loaded from the real
 *    declarative-specs directory (catch missing/renamed specs).
 * 4. Asserts orchestrator.systemPrompt resolves cleanly (catch placeholder drift).
 * 5. Asserts every continueWhile parses and evaluates with stubbed results
 *    matching the loop body's parseJson ids (catch expression errors at load time).
 *
 * **When to add a new flow:** after adding a new .json file to `src/flows/`,
 * add a `describe("new-flow-name", ...)` block here. The boilerplate is minimal —
 * the five assertions are the same for every flow.
 */
import * as path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { SpecRegistry } from "../agents/specifications/SpecRegistry";
import { SpecManager } from "../agents/SpecManager";
import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import { SpecLoader } from "../loaders/SpecLoader";
import { ExpressionEvaluator } from "../orchestrator/ExpressionEvaluator";
import { FlowContext } from "../orchestrator/FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
  LoopInstruction,
} from "../orchestrator/FlowInstruction";
import {
  isContainerInstruction,
  isLoopInstruction,
  isParallelInstruction,
} from "../orchestrator/FlowInstruction";
import { FlowLoader } from "../orchestrator/FlowLoader";
import { RoutineExecutor } from "../orchestrator/RoutineExecutor";
import { RoutineTool } from "../orchestrator/RoutineTool";
import { StepExecutorRegistry } from "../orchestrator/StepExecutorRegistry";
import { makeMockTypedEventBus } from "../test-utils";

// ── Helpers ──────────────────────────────────────────────────

/** Collect all parseJson: true agent IDs and routine ref IDs within a list of instructions (recursive). */
function collectParseJsonIds(
  instructions: FlowInstruction[],
  ids = new Set<string>(),
): Set<string> {
  for (const instr of instructions) {
    if (instr.type === "agent" && instr.parseJson) {
      ids.add(instr.id);
    }
    if (instr.type === "routine") {
      ids.add(instr.id);
    }
    if (isContainerInstruction(instr)) {
      collectParseJsonIds(instr.steps, ids);
    }
  }
  return ids;
}

/** Build a FlowContextLike with stubbed results for the given IDs, all with the same `passed` value. */
function makeStubContext(
  ids: string[],
  passed: boolean,
): {
  results: Map<string, { raw: string; parsed?: { passed: boolean } }>;
} {
  const results = new Map<string, { raw: string; parsed?: { passed: boolean } }>();
  for (const id of ids) {
    results.set(id, { raw: `stub output for ${id}`, parsed: { passed } });
  }
  return { results };
}

// ── Recursive collectors (walk routines) ─────────────────────

function collectAgentInstructions(instructions: FlowInstruction[], tasks: string[]): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      tasks.push(instr.prompt);
    }
    if (isContainerInstruction(instr)) {
      collectAgentInstructions(instr.steps, tasks);
    }
  }
}

function collectAgentSpecs(instructions: FlowInstruction[], specs: string[]): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      specs.push(instr.systemPrompt);
    }
    if (isContainerInstruction(instr)) {
      collectAgentSpecs(instr.steps, specs);
    }
  }
}

function collectLoops(
  instructions: FlowInstruction[],
  loops: LoopInstruction[] = [],
): LoopInstruction[] {
  for (const instr of instructions) {
    if (isLoopInstruction(instr)) {
      loops.push(instr);
      collectLoops(instr.steps, loops);
    } else if (isParallelInstruction(instr)) {
      collectLoops(instr.steps, loops);
    }
  }
  return loops;
}

/** Collect all agent tasks and all loops across all routines. */
function collectFromRoutines(routines: FlowDefinition["routines"]): {
  agentTasks: string[];
  loops: LoopInstruction[];
  specRefs: string[];
} {
  const agentTasks: string[] = [];
  const loops: LoopInstruction[] = [];
  const specRefs: string[] = [];

  for (const [, routine] of Object.entries(routines)) {
    collectAgentInstructions(routine.steps as FlowInstruction[], agentTasks);
    collectAgentSpecs(routine.steps as FlowInstruction[], specRefs);
    collectLoops(routine.steps as FlowInstruction[], loops);
  }

  return { agentTasks, loops, specRefs };
}

// ── Test factory ──────────────────────────────────────────────

interface FlowTestContext {
  flow: FlowDefinition;
  knownSpecs: ReadonlySet<string>;
  /** Additional params to merge into the test context for placeholder resolution. */
  additionalParams?: Record<string, string>;
}

async function loadFlow(
  flowsDir: string,
  name: string,
  specsDir: string,
): Promise<FlowTestContext> {
  const specManager = new SpecManager(new SpecRegistry(), new SpecLoader());
  await specManager.loadFromDirectory(specsDir);
  const knownSpecs = specManager.specNames();

  const loader = new FlowLoader({ flowsDir, knownSpecs });
  const flow = await loader.load(name);

  return { flow, knownSpecs };
}

function runCommonTests(name: string, ctx: () => FlowTestContext): void {
  // ── 1. Structural + semantic validation (implied by load success) ──

  it("loads without validation errors", () => {
    const { flow } = ctx();
    expect(flow.name).toBe(name);
    expect(Object.keys(flow.routines).length).toBeGreaterThan(0);
  });

  // ── 2. No unresolved placeholders in any task ──────────────────

  it("resolves all agent instruction tasks with no {{...}} survivors", () => {
    const { flow, additionalParams } = ctx();
    const ctxInner = new FlowContext({
      results: new Map(),
      prompt: "test-task",
    })
      .withParams({ plan: "test-plan", workspace: "/tmp/test-workspace", ...additionalParams })
      .withFeedback("test-feedback");

    const { agentTasks } = collectFromRoutines(flow.routines);

    for (const task of agentTasks) {
      const resolved = ctxInner.resolve(task);
      expect(resolved, `unresolved placeholder in task: "${task.slice(0, 80)}..."`).not.toMatch(
        /\{\{/,
      );
    }
  });

  // ── 3. Every agent.systemPrompt references a known spec ───────────────

  it("references only known agent specs", () => {
    const { flow, knownSpecs } = ctx();
    const { specRefs } = collectFromRoutines(flow.routines);

    for (const spec of specRefs) {
      expect(knownSpecs.has(spec), `unknown spec "${spec}" — not in declarative-specs`).toBe(true);
    }
  });

  // ── 4. Orchestrator.systemPrompt resolves cleanly (if present) ────

  it("skips orchestrator-specific tests when absent", () => {
    const { flow } = ctx();
    if (flow.orchestrator) {
      expect(flow.orchestrator.systemPrompt.length).toBeGreaterThan(0);

      const ctxOrch = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctxOrch.resolve(flow.orchestrator.systemPrompt);

      expect(resolved).not.toMatch(/\{\{/);
      expect(resolved).not.toMatch(/\}\}/);
    } else {
      expect(flow.orchestrator).toBeUndefined();
    }
  });

  // ── 5. continueWhile parses and evaluates ────────────────────

  it("continueWhile expressions parse and evaluate for all states", () => {
    const { flow } = ctx();
    const { loops } = collectFromRoutines(flow.routines);

    for (const loop of loops) {
      if (!loop.continueWhile) continue;

      // 5a. Parse must succeed (no syntax error).
      const expr = loop.continueWhile;
      expect(() => ExpressionEvaluator.parseExpression(expr)).not.toThrow();

      const parseJsonIds = [...collectParseJsonIds(loop.steps)];

      // 5b. With all results passing, the loop should exit (expression → false).
      if (parseJsonIds.length > 0) {
        const allPassed = makeStubContext(parseJsonIds, true);
        expect(ExpressionEvaluator.evaluateExpression(expr, allPassed)).toBe(false);
      }

      // 5c. With one result failing, the loop should continue (expression → true).
      if (parseJsonIds.length > 0) {
        const oneFailed = makeStubContext(parseJsonIds, true);
        const failingId = parseJsonIds[0];
        oneFailed.results.set(failingId, {
          raw: `stub output for ${failingId}`,
          parsed: { passed: false },
        });
        expect(ExpressionEvaluator.evaluateExpression(expr, oneFailed)).toBe(true);
      }

      // 5d. Missing required results should throw.
      const empty = { results: new Map() };
      expect(() => ExpressionEvaluator.evaluateExpression(expr, empty)).toThrow(
        "No result found for id",
      );
    }
  });

  // ── 6. RoutineTool name alignment with tools ──────────

  it("routine-based tools match registered RoutineTool names", () => {
    const { flow } = ctx();
    const registry = new StepExecutorRegistry();
    const executor = new RoutineExecutor(flow, registry, makeMockTypedEventBus());
    const routineToolNames = new Set<string>();

    for (const [routineName, routineDef] of Object.entries(flow.routines)) {
      const tool = new RoutineTool(flow.name, routineName, executor, routineDef, {
        getAgent: vi.fn().mockReturnValue(undefined),
        getAllAgents: vi.fn().mockReturnValue([]),
      } as unknown as AgentSupervisor);
      routineToolNames.add(tool.name);
    }

    for (const routineName of Object.keys(flow.routines)) {
      expect(routineToolNames.has(routineName)).toBe(true);
    }
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("flow round-trip", () => {
  const specsDir = path.join(__dirname, "..", "agents", "declarative-specs");

  describe("implement", () => {
    const flowsDir = path.join(__dirname, "implement");
    let ctx!: FlowTestContext;

    beforeAll(async () => {
      ctx = await loadFlow(flowsDir, "flow", specsDir);
    });

    runCommonTests("implement", () => ctx);
  });

  describe("review", () => {
    const flowsDir = path.join(__dirname, "review");
    let ctx!: FlowTestContext;

    beforeAll(async () => {
      ctx = await loadFlow(flowsDir, "flow", specsDir);
      ctx.additionalParams = { build_output: "test build output for review" };
    });

    runCommonTests("review", () => ctx);
  });

  describe("verify", () => {
    const flowsDir = path.join(__dirname, "verify");
    let ctx!: FlowTestContext;

    beforeAll(async () => {
      ctx = await loadFlow(flowsDir, "flow", specsDir);
      ctx.additionalParams = { build_output: "test build output for verify" };
    });

    runCommonTests("verify", () => ctx);
  });
});

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
import * as fs from "node:fs";
import * as path from "node:path";

import { jsonParse } from "@feature-forge/shared";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
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
import { makeMockToolRegistry, makeMockTypedEventBus } from "../test-utils";

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

  for (const routine of routines) {
    collectAgentInstructions(routine.steps as FlowInstruction[], agentTasks);
    collectAgentSpecs(routine.steps as FlowInstruction[], specRefs);
    collectLoops(routine.steps as FlowInstruction[], loops);
  }

  return { agentTasks, loops, specRefs };
}

// ── Tests ────────────────────────────────────────────────────

describe("flow round-trip", () => {
  const flowsDir = path.join(__dirname, "implement");
  const specsDir = path.join(__dirname, "..", "agents", "declarative-specs");

  // Load known spec names once for the whole suite.
  let knownSpecs!: ReadonlySet<string>;
  let loader!: FlowLoader;
  let flow!: FlowDefinition;

  beforeAll(async () => {
    const specManager = new SpecManager(new SpecRegistry(), new SpecLoader());
    await specManager.loadFromDirectory(specsDir);
    knownSpecs = specManager.specNames();

    // Load the single shipped flow. When more flows are added,
    // this iterates all .json files excluding flow-schema.json.
    // Using a single describe block per flow gives clean failure
    // output with the flow name in the describe header.
    loader = new FlowLoader({ flowsDir: flowsDir, knownSpecs });
    flow = await loader.load("flow");
  });

  describe("implement", () => {
    // ── 1. Structural + semantic validation (implied by load success) ──

    it("loads without validation errors", () => {
      expect(flow.name).toBe("implement");
      expect(flow.routines.length).toBeGreaterThan(0);
    });

    // ── 2. No unresolved placeholders in any task ──────────────────

    it("resolves orchestrator.systemPrompt with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(flow.orchestrator.systemPrompt);
      expect(resolved).not.toMatch(/\{\{/);
    });

    it("resolves all agent instruction tasks with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      })
        .withParams({ plan: "test-plan", workspace: "/tmp/test-workspace" })
        .withFeedback("test-feedback");

      const { agentTasks } = collectFromRoutines(flow.routines);

      for (const task of agentTasks) {
        const resolved = ctx.resolve(task);
        expect(resolved, `unresolved placeholder in task: "${task.slice(0, 80)}..."`).not.toMatch(
          /\{\{/,
        );
      }
    });

    // ── 3. Every agent.systemPrompt references a known spec ───────────────

    it("references only known agent specs", () => {
      const { specRefs } = collectFromRoutines(flow.routines);

      for (const spec of specRefs) {
        expect(knownSpecs.has(spec), `unknown spec "${spec}" — not in declarative-specs`).toBe(
          true,
        );
      }
    });

    // ── 4. Orchestrator.systemPrompt resolves cleanly ──────────────────

    it("orchestrator.systemPrompt is non-empty and resolves cleanly", () => {
      expect(flow.orchestrator.systemPrompt.length).toBeGreaterThan(0);

      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(flow.orchestrator.systemPrompt);

      expect(resolved).not.toMatch(/\{\{/);
      expect(resolved).not.toMatch(/\}\}/);
    });

    // ── 5. continueWhile parses and evaluates ────────────────────

    it("continueWhile expressions parse and evaluate for all states", () => {
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
          // Override the first id to passed: false.
          const failingId = parseJsonIds[0];
          oneFailed.results.set(failingId, {
            raw: `stub output for ${failingId}`,
            parsed: { passed: false },
          });
          expect(ExpressionEvaluator.evaluateExpression(expr, oneFailed)).toBe(true);
        }

        // 5d. Missing required results (builder without ?.) intentionally throws.
        // The expression !results.builder?.parsed?.passed uses a required `.`
        // on "builder" — if the builder hasn't run yet, that's a flow execution
        // ordering bug. The loop gate requires builder to have produced a result.
        const empty = { results: new Map() };
        expect(() => ExpressionEvaluator.evaluateExpression(expr, empty)).toThrow(
          "No result found for id",
        );
      }
    });

    // ── 6. RoutineTool name alignment with tools ──────────

    it("routine-based tools match registered RoutineTool names", () => {
      const registry = new StepExecutorRegistry();
      const executor = new RoutineExecutor(
        flow,
        registry,
        makeMockTypedEventBus(),
        makeMockToolRegistry(),
      );
      const routineToolNames = new Set<string>();

      for (const routineDef of flow.routines) {
        const tool = new RoutineTool(flow.name, routineDef, executor, {
          getAgent: vi.fn().mockReturnValue(undefined),
          getAllAgents: vi.fn().mockReturnValue([]),
        } as unknown as AgentSupervisor);
        routineToolNames.add(tool.name);
      }

      // Each routine is registered as a tool — verify the names match
      for (const routine of flow.routines) {
        expect(routineToolNames.has(routine.id)).toBe(true);
      }
    });
  });

  describe("flow-schema.json", () => {
    const schemaPath = path.join(__dirname, "flow-schema.json");

    it("loads and compiles without errors", () => {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = jsonParse<Record<string, unknown>>(raw);

      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);

      expect(() => ajv.compile(schema)).not.toThrow();
    });

    it("has top-level params property", () => {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = jsonParse<Record<string, unknown>>(raw);

      expect(schema.properties).toBeDefined();
      const props = schema.properties as Record<string, unknown>;
      expect(props.params).toBeDefined();

      const params = props.params as Record<string, unknown>;
      expect(params.type).toBe("array");
      const items = params.items as Record<string, unknown>;
      expect(items.required).toEqual(["name"]);
    });

    it("validates a flow with top-level params", () => {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = jsonParse<Record<string, unknown>>(raw);

      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      const flowWithParams = {
        $schema:
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/cli/src/flows/flow-schema.json",
        name: "test",
        command: "/test",
        orchestrator: { systemPrompt: "test" },
        routines: [{ id: "build", params: [], steps: [] }],
        params: [{ name: "base", description: "Target branch", default: "main" }],
      };

      const valid = validate(flowWithParams);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a flow without params (params is optional)", () => {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = jsonParse<Record<string, unknown>>(raw);

      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      const flowWithoutParams = {
        $schema:
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/cli/src/flows/flow-schema.json",
        name: "test",
        command: "/test",
        orchestrator: { systemPrompt: "test" },
        routines: [{ id: "build", params: [], steps: [] }],
      };

      const valid = validate(flowWithoutParams);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects a flow with invalid params (missing required 'name')", () => {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = jsonParse<Record<string, unknown>>(raw);

      const ajv = new Ajv({ allErrors: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      const flowWithInvalidParams = {
        $schema:
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/cli/src/flows/flow-schema.json",
        name: "test",
        command: "/test",
        orchestrator: { systemPrompt: "test" },
        routines: [{ id: "build", params: [], steps: [] }],
        params: [{}],
      };

      const valid = validate(flowWithInvalidParams);
      expect(valid).toBe(false);
      expect(validate.errors).not.toBeNull();
      expect(validate.errors!.some((e) => e.instancePath === "/params/0")).toBe(true);
    });
  });
});

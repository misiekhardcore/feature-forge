/**
 * **Flow round-trip contract test — drift guardrail.**
 *
 * This single test file would have caught flaws 2, 3, 6, and 10 at load time.
 * It validates every shipped flow in `src/flows/` against the live code:
 *
 * 1. Loads via FlowLoader (structural + semantic validation).
 * 2. Resolves every task and orchestrator.task through FlowContext
 *    and asserts no {{...}} survivors (catch dead/misspelled placeholders).
 * 3. Asserts every agent.spec is in the set loaded from the real
 *    declarative-specs directory (catch missing/renamed specs).
 * 4. Asserts orchestrator.task placeholders are all FlowContext builtins
 *    or declared toolParams (catch placeholder drift).
 * 5. Asserts every continueWhile parses and evaluates with stubbed results
 *    matching the loop body's parseJson ids (catch expression errors at load time).
 *
 * **When to add a new flow:** after adding a new .json file to `src/flows/`,
 * add a `describe("new-flow-name", ...)` block here. The boilerplate is minimal —
 * the five assertions are the same for every flow.
 *
 * **Note on F.2 (docs tracker sync):** deferred as brittle. The round-trip
 * test (this file) covers the critical invariant — docs drift is a
 * maintainability issue, not a correctness bug.
 */
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { SpecLoader } from "../agents/declarative-specs/SpecLoader";
import { ExpressionEvaluator } from "../orchestrator/ExpressionEvaluator";
import { FlowContext } from "../orchestrator/FlowContext";
import type {
  AgentInstruction,
  FlowDefinition,
  FlowInstruction,
  LoopInstruction,
} from "../orchestrator/FlowInstruction";
import { FlowLoader } from "../orchestrator/FlowLoader";

// ── Helpers ──────────────────────────────────────────────────

/**
 * TypeBox 1.3.0's Type.Static can't see the runtime-patched `steps`
 * property on parallel/loop schemas. Cast through unknown when
 * accessing container instruction `.steps`.
 */
function containerSteps(instr: FlowInstruction): FlowInstruction[] {
  return (instr as unknown as { steps: FlowInstruction[] }).steps;
}

/** Built-in FlowContext placeholders that don't need toolParam coverage. */
const FLOW_CONTEXT_BUILTINS = new Set(["task", "plan", "feedback", "workspace"]);

/** Extract all {{placeholder}} keys from a template string. */
function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{\{([^}]+)\}\}/g);
  return [...matches].map((m) => m[1]!.trim());
}

/** Collect all parseJson: true agent IDs within a list of instructions (recursive). */
function collectParseJsonIds(
  instructions: FlowInstruction[],
  ids = new Set<string>(),
): Set<string> {
  for (const instr of instructions) {
    if (instr.type === "agent" && (instr as AgentInstruction).parseJson) {
      ids.add(instr.id);
    }
    if (instr.type === "parallel" || instr.type === "loop") {
      collectParseJsonIds(containerSteps(instr), ids);
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

// ── Tests ────────────────────────────────────────────────────

describe("flow round-trip", () => {
  const flowsDir = __dirname;
  const specsDir = path.join(__dirname, "..", "agents", "declarative-specs");

  // Load known spec names once for the whole suite.
  let knownSpecs!: ReadonlySet<string>;

  beforeAll(async () => {
    const specLoader = new SpecLoader(specsDir);
    const factories = await specLoader.loadAll();
    knownSpecs = new Set(factories.keys());
  });

  // Load the single shipped flow. When more flows are added,
  // this iterates all .json files excluding flow-schema.json.
  // Using a single describe block per flow gives clean failure
  // output with the flow name in the describe header.
  const loader = new FlowLoader(flowsDir, knownSpecs);

  let flow: FlowDefinition;
  beforeAll(async () => {
    flow = await loader.load("implement");
  });

  describe("implement", () => {
    // ── 1. Structural + semantic validation (implied by load success) ──

    it("loads without validation errors", () => {
      expect(flow.name).toBe("implement");
      expect(flow.steps.length).toBeGreaterThan(0);
    });

    // ── 2. No unresolved placeholders in any task ──────────────────

    it("resolves orchestrator.task with no {{...}} survivors", () => {
      const ctx = new FlowContext(
        new Map(),
        "test-task",
        "test-plan",
        "/tmp/test-workspace",
        "test-feedback",
      );
      const resolved = ctx.resolve(flow.orchestrator.task);
      expect(resolved).not.toMatch(/\{\{/);
    });

    it("resolves all agent instruction tasks with no {{...}} survivors", () => {
      const ctx = new FlowContext(
        new Map(),
        "test-task",
        "test-plan",
        "/tmp/test-workspace",
        "test-feedback",
      );

      const agentTasks: string[] = [];
      collectAgentInstructions(flow.steps, agentTasks);

      for (const task of agentTasks) {
        const resolved = ctx.resolve(task);
        expect(resolved, `unresolved placeholder in task: "${task.slice(0, 80)}..."`).not.toMatch(
          /\{\{/,
        );
      }
    });

    // ── 3. Every agent.spec references a known spec ───────────────

    it("references only known agent specs", () => {
      const specRefs: string[] = [];
      collectAgentSpecs(flow.steps, specRefs);

      for (const spec of specRefs) {
        expect(knownSpecs.has(spec), `unknown spec "${spec}" — not in declarative-specs`).toBe(
          true,
        );
      }
    });

    // ── 4. Orchestrator.task placeholders match toolParams ────────

    it("orchestrator.task placeholders are all FlowContext builtins or toolParams", () => {
      const toolParamNames = new Set(flow.toolParams.map((p) => p.name));
      const placeholders = extractPlaceholders(flow.orchestrator.task);

      for (const ph of placeholders) {
        const isBuiltin = FLOW_CONTEXT_BUILTINS.has(ph) || ph.startsWith("results.");
        const isToolParam = toolParamNames.has(ph);

        expect(
          isBuiltin || isToolParam,
          `placeholder "{{${ph}}}" in orchestrator.task is neither a FlowContext builtin nor a toolParam (toolParams: ${[...toolParamNames].join(", ")})`,
        ).toBe(true);
      }
    });

    // ── 5. continueWhile parses and evaluates ────────────────────

    it("continueWhile expressions parse and evaluate for all states", () => {
      const loops = collectLoops(flow.steps);

      for (const loop of loops) {
        if (!loop.continueWhile) continue;

        // 5a. Parse must succeed (no syntax error).
        const expr = loop.continueWhile;
        expect(() => ExpressionEvaluator.parseExpression(expr)).not.toThrow();

        const parseJsonIds = [
          ...collectParseJsonIds(containerSteps(loop as unknown as FlowInstruction)),
        ];

        // 5b. With all results passing, the loop should exit (expression → false).
        if (parseJsonIds.length > 0) {
          const allPassed = makeStubContext(parseJsonIds, true);
          expect(ExpressionEvaluator.evaluateExpression(expr, allPassed)).toBe(false);
        }

        // 5c. With one result failing, the loop should continue (expression → true).
        if (parseJsonIds.length > 0) {
          const oneFailed = makeStubContext(parseJsonIds, true);
          // Override the first id to passed: false.
          const failingId = parseJsonIds[0]!;
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
  });
});

// ── Recursive collectors ──────────────────────────────────────

function collectAgentInstructions(instructions: FlowInstruction[], tasks: string[]): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      tasks.push(instr.task);
    }
    if (instr.type === "parallel" || instr.type === "loop") {
      collectAgentInstructions(containerSteps(instr), tasks);
    }
  }
}

function collectAgentSpecs(instructions: FlowInstruction[], specs: string[]): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      specs.push(instr.spec);
    }
    if (instr.type === "parallel" || instr.type === "loop") {
      collectAgentSpecs(containerSteps(instr), specs);
    }
  }
}

function collectLoops(
  instructions: FlowInstruction[],
  loops: LoopInstruction[] = [],
): LoopInstruction[] {
  for (const instr of instructions) {
    if (instr.type === "loop") {
      loops.push(instr as LoopInstruction);
      collectLoops(containerSteps(instr), loops);
    }
    if (instr.type === "parallel") {
      collectLoops(containerSteps(instr), loops);
    }
  }
  return loops;
}

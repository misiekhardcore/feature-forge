/**
 * **Flow round-trip contract test — drift guardrail.**
 *
 * This single test file would have caught flaws at load time.
 * It validates every shipped flow package in `src/flows/` against the live code:
 *
 * 1. Loads via FlowLoader (structural + semantic validation), asserting
 *    orchestrator.md exists alongside flow.json.
 * 2. Resolves every routine step task through FlowContext
 *    and asserts no {{...}} survivors (catch dead/misspelled placeholders).
 * 3. Asserts every agent.spec is in the set loaded from the real
 *    declarative-specs directory (catch missing/renamed specs).
 * 4. Asserts every continueWhile parses and evaluates with stubbed results
 *    matching the routine's parseJson ids (catch expression errors at load time).
 * 5. Asserts orchestrator placeholder {{task}} resolves correctly.
 *
 * **When to add a new flow:** after adding a new package directory to `src/flows/`,
 * add a `describe("new-flow-name", ...)` block here. The boilerplate is minimal —
 * the five assertions are the same for every flow.
 */
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
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

/** Build a context-like object with stubbed results for the given IDs. */
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

/** Recursively collect agent task templates from a routine's steps. */
function collectAgentTasks(instructions: FlowInstruction[], tasks: string[]): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      tasks.push(instr.task);
    }
    if (instr.type === "parallel" || instr.type === "loop") {
      collectAgentTasks(containerSteps(instr), tasks);
    }
  }
}

/** Recursively collect agent specInput entries from a routine's steps. */
function collectAgentSpecInputs(
  instructions: FlowInstruction[],
  specInputs: Array<{ id: string; entries: Record<string, string> }>,
): void {
  for (const instr of instructions) {
    if (instr.type === "agent") {
      const agentInstr = instr as AgentInstruction;
      if (agentInstr.specInput) {
        specInputs.push({ id: agentInstr.id, entries: agentInstr.specInput });
      } else {
        specInputs.push({ id: agentInstr.id, entries: {} });
      }
    }
    if (instr.type === "parallel" || instr.type === "loop") {
      collectAgentSpecInputs(containerSteps(instr), specInputs);
    }
  }
}

/** Recursively collect agent spec references from a routine's steps. */
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

/** Recursively collect loops from a routine's steps. */
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

  // Scan synchronously — describe blocks must be registered at module load
  // time, before beforeAll runs. This is safe because the flows directory
  // is part of the repo and always present.
  const flowDirs = fsSync
    .readdirSync(flowsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const loader = new FlowLoader(flowsDir, knownSpecs);

  // ── Test each flow package ────────────────────────────────

  for (const flowName of flowDirs) {
    let flow: FlowDefinition;
    beforeAll(async () => {
      flow = await loader.load(flowName);
    });

    describe(flowName, () => {
      // ── 1. Structural + semantic validation (implied by load success) ──

      it("loads without validation errors", () => {
        expect(flow.name).toBe(flowName);
        expect(Object.keys(flow.routines).length).toBeGreaterThan(0);
      });

      it("has orchestrator.md file alongside flow.json", async () => {
        const mdPath = path.join(flowsDir, flowName, flow.orchestrator.prompt);
        const exists = await fs
          .access(mdPath)
          .then(() => true)
          .catch(() => false);
        expect(exists, `orchestrator prompt file not found: ${mdPath}`).toBe(true);
      });

      // ── 2. No unresolved placeholders in routine agent tasks ────────

      it("resolves all routine step agent tasks with no {{...}} survivors", () => {
        const ctx = new FlowContext(
          new Map(),
          "test-task",
          "test-plan",
          "/tmp/test-workspace",
          "test-feedback",
        );

        for (const [routineName, routine] of Object.entries(flow.routines)) {
          const agentTasks: string[] = [];
          collectAgentTasks(routine.steps, agentTasks);

          for (const task of agentTasks) {
            const resolved = ctx.resolve(task);
            expect(
              resolved,
              `unresolved placeholder in routine "${routineName}" task: "${task.slice(0, 80)}..."`,
            ).not.toMatch(/\{\{/);
          }
        }
      });

      // ── 3. Every agent.spec references a known spec ─────────────────

      it("references only known agent specs", () => {
        for (const [routineName, routine] of Object.entries(flow.routines)) {
          const specRefs: string[] = [];
          collectAgentSpecs(routine.steps, specRefs);

          for (const spec of specRefs) {
            expect(
              knownSpecs.has(spec),
              `unknown spec "${spec}" in routine "${routineName}" — not in declarative-specs`,
            ).toBe(true);
          }
        }
      });

      // ── 4. continueWhile parses and evaluates ──────────────────────

      it("continueWhile expressions parse and evaluate for all states", () => {
        for (const [routineName, routine] of Object.entries(flow.routines)) {
          const loops = collectLoops(routine.steps);

          for (const loop of loops) {
            if (!loop.continueWhile) continue;

            // 4a. Parse must succeed (no syntax error).
            const expr = loop.continueWhile;
            expect(
              () => ExpressionEvaluator.parseExpression(expr),
              `invalid continueWhile in routine "${routineName}" loop "${loop.id}": ${expr}`,
            ).not.toThrow();

            const parseJsonIds = [
              ...collectParseJsonIds(containerSteps(loop as unknown as FlowInstruction)),
            ];

            // 4b. With all results passing, the loop should exit (expression → false).
            if (parseJsonIds.length > 0) {
              const allPassed = makeStubContext(parseJsonIds, true);
              expect(
                ExpressionEvaluator.evaluateExpression(expr, allPassed),
                `continueWhile should be false when all passed, routine "${routineName}" loop "${loop.id}"`,
              ).toBe(false);
            }

            // 4c. With one result failing, the loop should continue (expression → true).
            if (parseJsonIds.length > 0) {
              const oneFailed = makeStubContext(parseJsonIds, true);
              const failingId = parseJsonIds[0]!;
              oneFailed.results.set(failingId, {
                raw: `stub output for ${failingId}`,
                parsed: { passed: false },
              });
              expect(
                ExpressionEvaluator.evaluateExpression(expr, oneFailed),
                `continueWhile should be true when one failed, routine "${routineName}" loop "${loop.id}"`,
              ).toBe(true);
            }

            // 4d. Missing required results throws (ordering bug).
            const empty = { results: new Map() };
            expect(() => ExpressionEvaluator.evaluateExpression(expr, empty)).toThrow(
              "No result found for id",
            );
          }
        }
      });

      // ── 5. Every agent step declares specInput ────────────────────

      it("every agent step declares specInput", () => {
        for (const [routineName, routine] of Object.entries(flow.routines)) {
          const specInputs: Array<{ id: string; entries: Record<string, string> }> = [];
          collectAgentSpecInputs(routine.steps, specInputs);

          for (const { id, entries } of specInputs) {
            const keys = Object.keys(entries);
            expect(
              keys.length,
              `agent "${id}" in routine "${routineName}" must declare specInput`,
            ).toBeGreaterThan(0);
          }
        }
      });

      // ── 5b. No unresolved placeholders in specInput values ────────

      it("resolves all agent specInput values with no {{...}} survivors", () => {
        const ctx = new FlowContext(
          new Map(),
          "test-task",
          "test-plan",
          "/tmp/test-workspace",
          "test-feedback",
        );
        // Stub a builder result so {{results.builder.raw}} resolves.
        const ctxWithResults = ctx.withResult("builder", { raw: "<stub build output>" });

        for (const [routineName, routine] of Object.entries(flow.routines)) {
          const specInputs: Array<{ id: string; entries: Record<string, string> }> = [];
          collectAgentSpecInputs(routine.steps, specInputs);

          for (const { id, entries } of specInputs) {
            for (const [key, value] of Object.entries(entries)) {
              const resolved = ctxWithResults.resolve(value);
              expect(
                resolved,
                `unresolved placeholder in routine "${routineName}" agent "${id}" ` +
                  `specInput.${key}: "${value.slice(0, 80)}..."`,
              ).not.toMatch(/\{\{/);
            }
          }
        }
      });

      // ── 6. Orchestrator prompt resolves correctly ─────────────────

      it("orchestrator prompt resolves {{task}} with no survivors", async () => {
        const mdPath = path.join(flowsDir, flowName, flow.orchestrator.prompt);
        const promptText = await fs.readFile(mdPath, "utf-8");

        const ctx = new FlowContext(new Map(), "test-task", "");
        const resolved = ctx.resolve(promptText);

        expect(resolved).not.toMatch(/\{\{/);
        expect(resolved).toContain("test-task");
      });
    });
  }
});

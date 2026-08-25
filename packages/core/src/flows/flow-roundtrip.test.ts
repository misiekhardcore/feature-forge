/**
 * **Flow round-trip contract test — drift guardrail.**
 *
 * This single test file would have caught flaws 2, 3, 6, and 10 at load time.
 * It validates every shipped flow in `src/flows/definitions/` against the live code:
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
 * **When to add a new flow:** after adding a new .json file to
 * `src/flows/definitions/`, add a `describe("new-flow-name", ...)` block here.
 * The boilerplate is minimal — the five core assertions are the same for every
 * flow; flow-specific blocks may add extra checks (e.g. implement asserts
 * open_pr/build_loop instruction ordering and RoutineTool name alignment).
 */
import * as fs from "node:fs";
import * as path from "node:path";

// Test-only value import from cli: RoutineTool stays cli-owned (S6 seam, D4: renders with pi-tui).
import { RoutineTool } from "@feature-forge/cli/src/tools/RoutineTool";
import { makeMockToolRegistry, makeMockTypedEventBus } from "@feature-forge/core/test-utils";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SpecManager } from "../agents";
import { SpecRegistry } from "../agents/specifications";
import { SpecLoader } from "../agents/specifications";
import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import { StepExecutorRegistry } from "../executors/StepExecutorRegistry";
import { jsonParse } from "../helpers";
import { RoutineExecutor } from "../routines/RoutineExecutor";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { FlowContext } from "./FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
  LoopInstruction,
  RoutineRefInstruction,
  ShellInstruction,
} from "./FlowInstruction";
import {
  isContainerInstruction,
  isLoopInstruction,
  isParallelInstruction,
} from "./FlowInstruction";
import { FlowLoader } from "./FlowLoader";

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
    collectAgentInstructions(routine.steps, agentTasks);
    collectAgentSpecs(routine.steps, specRefs);
    collectLoops(routine.steps, loops);
  }

  return { agentTasks, loops, specRefs };
}

/** Collect every shell step's `command` and optional `cwd` across routines (recursive). */
function collectShellSteps(
  instructions: FlowInstruction[],
  steps: Array<{ command: string; cwd: string | undefined }> = [],
): Array<{ command: string; cwd: string | undefined }> {
  for (const instr of instructions) {
    if (instr.type === "shell") {
      steps.push({ command: instr.command, cwd: instr.cwd });
    }
    if (isContainerInstruction(instr)) {
      collectShellSteps(instr.steps, steps);
    }
  }
  return steps;
}

// ── Tests ────────────────────────────────────────────────────

describe("flow round-trip", () => {
  const flowsDir = path.join(__dirname, "definitions", "implement");
  const specsDir = path.join(__dirname, "..", "agents", "specifications", "templates");

  // Load known spec names once for the whole suite.
  let knownSpecs!: ReadonlySet<string>;
  let loader!: FlowLoader;
  let flow!: FlowDefinition;

  beforeAll(async () => {
    const specManager = new SpecManager(new SpecRegistry(), new SpecLoader());
    await specManager.loadFromDirectory(specsDir);
    await specManager.loadFromDirectory(flowsDir); // the flow's own orchestrator.md
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

    it("declares no promptParams on the orchestrator config", () => {
      const orchestrator = flow.orchestrator as { promptParams?: unknown };
      expect(orchestrator.promptParams).toBeUndefined();
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

    // ── 6. open_pr step positions ─────────────────────────

    it("open_pr has fetch, rebase, check-clean between commit and branch (push)", () => {
      const openPr = flow.routines.find((r) => r.id === "open_pr");
      expect(openPr).toBeDefined();

      const steps = openPr?.steps as FlowInstruction[];
      const ids = steps.map((s) => s.id);

      const commitIdx = ids.indexOf("commit");
      const fetchIdx = ids.indexOf("fetch");
      const rebaseIdx = ids.indexOf("rebase");
      const checkCleanIdx = ids.indexOf("check-clean");
      const branchIdx = ids.indexOf("branch");

      expect(commitIdx).toBeGreaterThanOrEqual(0);
      expect(fetchIdx).toBe(commitIdx + 1);
      expect(rebaseIdx).toBe(fetchIdx + 1);
      expect(checkCleanIdx).toBe(rebaseIdx + 1);
      expect(branchIdx).toBe(rebaseIdx + 2);
    });

    it("open_pr shell command uses heredoc and --body-file for shell-safe PR bodies", () => {
      const openPr = flow.routines.find((r) => r.id === "open_pr");
      expect(openPr).toBeDefined();

      const prStep = (openPr?.steps as FlowInstruction[]).find(
        (s): s is ShellInstruction => s.type === "shell" && s.id === "pr",
      );
      expect(prStep).toBeDefined();

      const cmd = prStep!.command;

      // Must not use inline --body (shell-unsafe)
      expect(cmd).not.toMatch(/--body\s/);

      // Must use --body-file with $$ process-unique temp file
      expect(cmd).toMatch(/--body-file/);
      expect(cmd).toMatch(/\/tmp\/ff-pr-body-\$\$\.md/);

      // Must use heredoc with quoted delimiter (no shell expansion inside)
      expect(cmd).toMatch(/<<\s*'FFEOF'/);

      // Must clean up temp file after PR creation
      expect(cmd).toMatch(/rm\s+-f\s+\/tmp\/ff-pr-body-\$\$\.md/);
    });

    // ── 6b. build_loop step positions ─────────────────────

    it("build_loop starts with a non-blocking sync step before builder and inspect", () => {
      const runBuildLoop = flow.routines.find((r) => r.id === "run_build_loop");
      expect(runBuildLoop).toBeDefined();

      const loop = (runBuildLoop?.steps as FlowInstruction[]).find(
        (s): s is LoopInstruction => s.type === "loop",
      );
      expect(loop).toBeDefined();
      expect(loop?.maxIterations).toBe(3);
      expect(loop?.accumulateFrom).toEqual(["call_review", "call_verify"]);

      const bodyIds = loop?.steps.map((s) => s.id) ?? [];
      const syncIdx = bodyIds.indexOf("sync");
      const builderIdx = bodyIds.indexOf("builder");
      const inspectIdx = bodyIds.indexOf("inspect");

      // sync must be the first child of build_loop, ordered sync → builder → inspect.
      expect(syncIdx).toBe(0);
      expect(builderIdx).toBe(syncIdx + 1);
      expect(inspectIdx).toBe(builderIdx + 1);

      // sync is a best-effort fetch — it must never fail the loop or the routine.
      const sync = loop?.steps[syncIdx];
      expect(sync?.type).toBe("shell");
      expect((sync as { failFast?: boolean })?.failFast).toBe(false);
    });

    // ── 7. RoutineTool name alignment with tools ──────────

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

  describe("resolve-pr-feedback", () => {
    const resolvePrFlowDir = path.join(__dirname, "definitions", "resolve-pr-feedback");

    let resolvePrFlow!: FlowDefinition;
    let resolvePrSpecs!: SpecManager;

    beforeAll(async () => {
      // Mirror FlowRegistrar: declarative specs plus the flow's own
      // orchestrator.md, registered under its frontmatter id.
      resolvePrSpecs = new SpecManager(new SpecRegistry(), new SpecLoader());
      await resolvePrSpecs.loadFromDirectory(specsDir);
      await resolvePrSpecs.loadFromDirectory(resolvePrFlowDir);

      const resolvePrLoader = new FlowLoader({
        flowsDir: resolvePrFlowDir,
        knownSpecs: resolvePrSpecs.specNames(),
      });
      resolvePrFlow = await resolvePrLoader.load("flow");
    });

    it("declares name, command, and params", () => {
      expect(resolvePrFlow.name).toBe("resolve-pr-feedback");
      expect(resolvePrFlow.command).toBe("/resolve-pr-feedback");
      expect(resolvePrFlow.params).toEqual([
        { name: "pr", description: "Pull request number to resolve feedback on" },
      ]);
    });

    it("declares the fetch_pr_comments, apply_feedback, and disposition_comments routines", () => {
      expect(resolvePrFlow.routines.map((r) => r.id)).toEqual([
        "fetch_pr_comments",
        "apply_feedback",
        "disposition_comments",
      ]);
    });

    it("fetch_pr_comments runs gh pr view and reviewThreads shell steps", () => {
      const routine = resolvePrFlow.routines.find((r) => r.id === "fetch_pr_comments");
      expect(routine).toBeDefined();
      expect(routine?.params).toEqual([
        { name: "pr", description: "PR number" },
        { name: "owner", description: "Repository owner" },
        { name: "repo", description: "Repository name" },
      ]);

      const steps = routine?.steps as FlowInstruction[];
      expect(steps.map((s) => s.id)).toEqual(["pr_info", "review_threads"]);
      for (const step of steps) {
        expect(step.type).toBe("shell");
        expect((step as { failFast?: boolean }).failFast).toBe(true);
      }
      expect((steps[0] as { command?: string }).command).toContain("gh pr view {{pr}}");
      expect((steps[0] as { command?: string }).command).toContain("nameWithOwner");
      expect((steps[1] as { command?: string }).command).toContain("reviewThreads");
    });

    it("apply_feedback routes to implement.run_build_loop via a routine ref", () => {
      const routine = resolvePrFlow.routines.find((r) => r.id === "apply_feedback");
      expect(routine).toBeDefined();
      expect(routine?.params.map((p) => p.name)).toEqual(["workspace", "task", "plan"]);

      const steps = routine?.steps as FlowInstruction[];
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("routine");
      const ref = steps[0] as RoutineRefInstruction;
      expect(ref.target).toBe("implement.run_build_loop");
      expect(ref.output_as).toBe("build_result");
      expect(ref.input).toEqual({
        workspace: "{{workspace}}",
        task: "{{task}}",
        plan: "{{plan}}",
      });
    });

    it("disposition_comments posts a reply and conditionally resolves the thread", () => {
      const routine = resolvePrFlow.routines.find((r) => r.id === "disposition_comments");
      expect(routine).toBeDefined();
      expect(routine?.params.map((p) => p.name)).toEqual(["threadId", "verdict", "reply"]);
      const verdictDesc = routine?.params.find((p) => p.name === "verdict")?.description;
      expect(verdictDesc).toBe("fixed|fixed-differently|replied|not-addressing|needs-human");

      const steps = routine?.steps as FlowInstruction[];
      expect(steps.map((s) => s.id)).toEqual(["post_reply", "resolve_thread"]);
      const postReply = steps[0] as { command?: string };
      expect(postReply.command).toContain("addPullRequestReviewThreadReply");
      // Reply goes through a temp file + --field body=@file — never inline
      // (apostrophes in an LLM reply would break/escape an inline shell arg).
      expect(postReply.command).toContain("body=@/tmp/ff-reply-$$.md");
      expect(postReply.command).not.toContain("-f body='");
      // A failed post must fail the routine — the disposition must not be
      // silently swallowed.
      expect((steps[0] as { failFast?: boolean }).failFast).toBe(true);
      const resolveThread = steps[1] as { command?: string };
      expect(resolveThread.command).toContain("resolveReviewThread");
      expect(resolveThread.command).toContain("fixed|fixed-differently|not-addressing");
      // The verdict word is quoted in the case pattern (injection surface).
      expect(resolveThread.command).toContain('case "{{verdict}}"');
      expect((steps[1] as { failFast?: boolean }).failFast).toBe(false);
    });

    it("resolves all shell commands and cwds with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "42",
        params: new Map([
          ["pr", "42"],
          ["owner", "misiekhardcore"],
          ["repo", "feature-forge"],
          ["workspace", "/tmp/test-workspace"],
          ["threadId", "PRRT_test"],
          ["verdict", "fixed"],
          ["reply", "Fixed in abc123."],
        ]),
      });

      const shellSteps: Array<{ command: string; cwd: string | undefined }> = [];
      for (const routine of resolvePrFlow.routines) {
        collectShellSteps(routine.steps, shellSteps);
      }
      expect(shellSteps.length).toBeGreaterThan(0);

      for (const { command, cwd } of shellSteps) {
        const resolvedCommand = ctx.resolve(command);
        expect(
          resolvedCommand,
          `unresolved placeholder in shell command: "${command.slice(0, 80)}..."`,
        ).not.toMatch(/\{\{/);
        if (cwd !== undefined) {
          const resolvedCwd = ctx.resolve(cwd);
          expect(
            resolvedCwd,
            `unresolved placeholder in shell cwd: "${cwd.slice(0, 80)}..."`,
          ).not.toMatch(/\{\{/);
        }
      }
    });

    it("configures the orchestrator persona", () => {
      expect(resolvePrFlow.orchestrator?.systemPrompt).toBe("resolve-pr-feedback-orchestrator");
      expect(resolvePrFlow.orchestrator?.prompt).toBe("{{prompt}}");
    });

    it("resolves orchestrator.prompt with no {{...}} survivors", () => {
      const ctx = new FlowContext({ results: new Map(), prompt: "42" });
      const resolved = ctx.resolve(resolvePrFlow.orchestrator.prompt ?? "");
      expect(resolved).toBe("42");
      expect(resolved).not.toMatch(/\{\{/);
    });

    it("orchestrator.systemPrompt resolves to a loaded spec", () => {
      expect(resolvePrSpecs.specNames().has(resolvePrFlow.orchestrator.systemPrompt)).toBe(true);
      const spec = resolvePrSpecs.resolve({ spec: resolvePrFlow.orchestrator.systemPrompt });
      expect(spec.id).toBe("resolve-pr-feedback-orchestrator");
    });
  });

  describe("review", () => {
    const reviewFlowDir = path.join(__dirname, "definitions", "review");

    let reviewFlow!: FlowDefinition;
    let reviewSpecs!: SpecManager;

    beforeAll(async () => {
      // Mirror FlowRegistrar: declarative specs plus the flow's own
      // orchestrator.md, registered under its frontmatter id.
      reviewSpecs = new SpecManager(new SpecRegistry(), new SpecLoader());
      await reviewSpecs.loadFromDirectory(specsDir);
      await reviewSpecs.loadFromDirectory(reviewFlowDir);

      const reviewLoader = new FlowLoader({
        flowsDir: reviewFlowDir,
        knownSpecs: reviewSpecs.specNames(),
      });
      reviewFlow = await reviewLoader.load("flow");
    });

    it("loads without validation errors", () => {
      expect(reviewFlow.name).toBe("review");
      expect(reviewFlow.routines.length).toBeGreaterThan(0);
      expect(reviewFlow.command).toBe("/review");
    });

    it("resolves orchestrator.systemPrompt with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(reviewFlow.orchestrator.systemPrompt);
      expect(resolved).not.toMatch(/\{\{/);
    });

    it("resolves all agent instruction tasks with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      }).withParams({ changes: "test-changes", workspace: "/tmp/test-workspace" });

      const { agentTasks } = collectFromRoutines(reviewFlow.routines);

      for (const task of agentTasks) {
        const resolved = ctx.resolve(task);
        expect(resolved, `unresolved placeholder in task: "${task.slice(0, 80)}..."`).not.toMatch(
          /\{\{/,
        );
      }
    });

    it("references only known agent specs", () => {
      const { specRefs } = collectFromRoutines(reviewFlow.routines);

      for (const spec of specRefs) {
        expect(knownSpecs.has(spec), `unknown spec "${spec}" — not in declarative-specs`).toBe(
          true,
        );
      }
    });

    it("orchestrator.systemPrompt is non-empty, resolves cleanly, and resolves to a loaded spec", () => {
      expect(reviewFlow.orchestrator.systemPrompt.length).toBeGreaterThan(0);

      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(reviewFlow.orchestrator.systemPrompt);

      expect(resolved).not.toMatch(/\{\{/);
      expect(resolved).not.toMatch(/\}\}/);

      expect(reviewSpecs.specNames().has(reviewFlow.orchestrator.systemPrompt)).toBe(true);
      const spec = reviewSpecs.resolve({ spec: reviewFlow.orchestrator.systemPrompt });
      expect(spec.id).toBe("review-orchestrator");
    });
  });

  describe("verify", () => {
    const verifyFlowDir = path.join(__dirname, "definitions", "verify");

    let verifyFlow!: FlowDefinition;
    let verifySpecs!: SpecManager;

    beforeAll(async () => {
      // Mirror FlowRegistrar: declarative specs plus the flow's own
      // orchestrator.md, registered under its frontmatter id.
      verifySpecs = new SpecManager(new SpecRegistry(), new SpecLoader());
      await verifySpecs.loadFromDirectory(specsDir);
      await verifySpecs.loadFromDirectory(verifyFlowDir);

      const verifyLoader = new FlowLoader({
        flowsDir: verifyFlowDir,
        knownSpecs: verifySpecs.specNames(),
      });
      verifyFlow = await verifyLoader.load("flow");
    });

    it("loads without validation errors", () => {
      expect(verifyFlow.name).toBe("verify");
      expect(verifyFlow.routines.length).toBeGreaterThan(0);
      expect(verifyFlow.command).toBe("/verify");
    });

    it("resolves orchestrator.systemPrompt with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(verifyFlow.orchestrator.systemPrompt);
      expect(resolved).not.toMatch(/\{\{/);
    });

    it("resolves all agent instruction tasks with no {{...}} survivors", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      }).withParams({ changes: "test-changes", workspace: "/tmp/test-workspace" });

      const { agentTasks } = collectFromRoutines(verifyFlow.routines);

      for (const task of agentTasks) {
        const resolved = ctx.resolve(task);
        expect(resolved, `unresolved placeholder in task: "${task.slice(0, 80)}..."`).not.toMatch(
          /\{\{/,
        );
      }
    });

    it("references only known agent specs", () => {
      const { specRefs } = collectFromRoutines(verifyFlow.routines);

      for (const spec of specRefs) {
        expect(knownSpecs.has(spec), `unknown spec "${spec}" — not in declarative-specs`).toBe(
          true,
        );
      }
    });

    it("orchestrator.systemPrompt is non-empty, resolves cleanly, and resolves to a loaded spec", () => {
      expect(verifyFlow.orchestrator.systemPrompt.length).toBeGreaterThan(0);

      const ctx = new FlowContext({
        results: new Map(),
        prompt: "test-task",
      });
      const resolved = ctx.resolve(verifyFlow.orchestrator.systemPrompt);

      expect(resolved).not.toMatch(/\{\{/);
      expect(resolved).not.toMatch(/\}\}/);

      expect(verifySpecs.specNames().has(verifyFlow.orchestrator.systemPrompt)).toBe(true);
      const spec = verifySpecs.resolve({ spec: verifyFlow.orchestrator.systemPrompt });
      expect(spec.id).toBe("verify-orchestrator");
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
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/core/src/flows/flow-schema.json",
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
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/core/src/flows/flow-schema.json",
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
          "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/core/src/flows/flow-schema.json",
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

// ── set_flow_param guardrails ────────────────────────────────

/** Extract the frontmatter `tools:` list from an orchestrator.md file. */
function parseFrontmatterTools(markdown: string): string[] {
  const frontmatter = markdown.split(/^---\s*$/m)[1] ?? "";
  const toolsMatch = frontmatter.match(/^tools:\n((?:^ {2}- .*$\n?)+)/m);
  if (!toolsMatch) return [];
  return toolsMatch[1]
    .split("\n")
    .map((line) => line.trim().replace(/^-\s+/, ""))
    .filter(Boolean);
}

// The legacy flow-scoped naming this guardrail protects against (e.g.
// implement + the shared set_flow_param name). Built from parts so the
// repo-wide grep gate for the scoped naming stays clean — the guardrail
// itself must not re-introduce the literal it polices.
const FLOW_SCOPED_SET_PARAM_SUFFIX = "_set_flow_" + "param";

describe("set_flow_param guardrails", () => {
  // The flow-scoped set_flow_param routines were replaced by one shared
  // global tool (PR #218 rework). These tests keep the flows and their
  // orchestrator personas from regressing to flow-scoped names.
  const guardrailFlowDirs = ["implement", "review", "verify", "resolve-pr-feedback"];
  const guardrailSpecsDir = path.join(__dirname, "..", "agents", "specifications", "templates");

  let loadedFlows: FlowDefinition[] = [];
  let orchestratorDocs: string[] = [];

  beforeAll(async () => {
    const specManager = new SpecManager(new SpecRegistry(), new SpecLoader());
    await specManager.loadFromDirectory(guardrailSpecsDir);
    loadedFlows = [];
    orchestratorDocs = [];
    for (const flowName of guardrailFlowDirs) {
      const flowDir = path.join(__dirname, "definitions", flowName);
      await specManager.loadFromDirectory(flowDir);
      const loader = new FlowLoader({
        flowsDir: flowDir,
        knownSpecs: specManager.specNames(),
      });
      loadedFlows.push(await loader.load("flow"));
      orchestratorDocs.push(fs.readFileSync(path.join(flowDir, "orchestrator.md"), "utf-8"));
    }
  });

  it("no flow declares a flow-scoped set_flow_param routine", () => {
    expect(loadedFlows.map((f) => f.name)).toEqual(guardrailFlowDirs);
    for (const flow of loadedFlows) {
      for (const routine of flow.routines) {
        expect(
          routine.id.endsWith(FLOW_SCOPED_SET_PARAM_SUFFIX),
          `flow "${flow.name}" declares flow-scoped routine "${routine.id}"`,
        ).toBe(false);
      }
    }
  });

  it("every orchestrator persona lists the shared set_flow_param tool", () => {
    for (const [i, markdown] of orchestratorDocs.entries()) {
      const tools = parseFrontmatterTools(markdown);
      expect(tools, `flow "${guardrailFlowDirs[i]}" has no tools list`).toContain("set_flow_param");
      const flowScopedTools = tools.filter((tool) => tool.endsWith(FLOW_SCOPED_SET_PARAM_SUFFIX));
      expect(
        flowScopedTools,
        `flow "${guardrailFlowDirs[i]}" lists flow-scoped tools: ${flowScopedTools.join(", ")}`,
      ).toEqual([]);
    }
  });
});

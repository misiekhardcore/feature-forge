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

import { Tool } from "@feature-forge/core/tools";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Type } from "typebox";
import { beforeAll, describe, expect, it } from "vitest";

import { SpecManager } from "../agents";
import { SpecRegistry } from "../agents/specifications";
import { SpecLoader } from "../agents/specifications";
import { jsonParse } from "../helpers";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import { FlowContext } from "./FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
  LoopInstruction,
  RoutineRefInstruction,
  ShellInstruction,
  WorkspaceInstruction,
} from "./FlowInstruction";
import {
  isContainerInstruction,
  isLoopInstruction,
  isParallelInstruction,
} from "./FlowInstruction";
import { discoverFlowDirectories, FlowLoader } from "./FlowLoader";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Local stand-in for the cli `RoutineTool` (which stays cli-owned, S6 seam):
 * reproduces only the name contract this test observes. The real tool renders
 * progress with pi-tui at the composition root; the round-trip test only
 * asserts that registered routine tools are named after the routine ids.
 */
class TestRoutineTool extends Tool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters = Type.Object({});

  constructor(flowName: string, routineDef: { id: string }) {
    super();
    this.name = routineDef.id;
    this.label = `Routine: ${flowName}/${routineDef.id}`;
    this.description = "stub routine tool";
  }

  async execute(): Promise<never> {
    throw new Error("no-op stub: tests never invoke routine tools");
  }
}

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

      // The fetch/rebase steps must target a freshly-fetched base: the raw
      // commands pin the session base so the branch is rebased onto the
      // remote's current tip, never a stale local main.
      const fetchStep = steps.find(
        (s): s is ShellInstruction => s.type === "shell" && s.id === "fetch",
      );
      const rebaseStep = steps.find(
        (s): s is ShellInstruction => s.type === "shell" && s.id === "rebase",
      );
      expect(fetchStep).toBeDefined();
      expect(rebaseStep).toBeDefined();
      expect(fetchStep!.command).toBe("git fetch origin {{session.base}}");
      expect(rebaseStep!.command).toBe("git rebase origin/{{session.base}}");
    });

    it("create_workspace workspace step defers branch and baseRef to templates", () => {
      // An absent baseRef must fall through to the provider default
      // (origin/HEAD) and an absent branch must generate a forge/ws-* name.
      // The step defers both to templates instead of hardcoding a base.
      const routine = flow.routines.find((r) => r.id === "create_workspace");
      expect(routine).toBeDefined();

      const ws = (routine?.steps as FlowInstruction[]).find(
        (s): s is WorkspaceInstruction => s.type === "workspace",
      );
      expect(ws).toBeDefined();
      expect(ws!.provider).toBe("git-worktree");
      expect(ws!.branch).toBe("{{branch}}");
      expect(ws!.baseRef).toBe("{{baseRef}}");
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
      const routineToolNames = new Set<string>();

      for (const routineDef of flow.routines) {
        const tool = new TestRoutineTool(flow.name, routineDef);
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

// ── flow docs guardrails ─────────────────────────────────────

/** Extract a frontmatter `{field}:` list (e.g. `tools:`, `skills:`) from an orchestrator.md file. */
function parseFrontmatterList(markdown: string, field: string, stripQuotes = false): string[] {
  const frontmatter = markdown.split(/^---\s*$/m)[1] ?? "";
  const listMatch = frontmatter.match(new RegExp(`^${field}:\\n((?:^ {2}- .*$\\n?)+)`, "m"));
  if (!listMatch) {
    // Fail loudly instead of returning [] - a frontmatter format change would
    // otherwise surface as a misleading "missing skill/tool" failure.
    const idLine =
      frontmatter
        .split("\n")
        .find((line) => /^id:/.test(line.trim()))
        ?.trim() ?? "";
    throw new Error(`orchestrator frontmatter has no "${field}" list (${idLine})`);
  }
  return listMatch[1]
    .split("\n")
    .map((line) => {
      const item = line.trim().replace(/^-\s+/, "");
      return stripQuotes ? item.replace(/^"|"$/g, "") : item;
    })
    .filter(Boolean);
}

/**
 * Strip a project-local generic memory overlay from an orchestrator.md /
 * references prose doc so the .forge copies can be compared against the
 * definitions copies. feature-forge's own .forge may carry an uncommitted
 * memory overlay - the shape generated by the agents-memo runtime overlay
 * (a `## Memory` section, `memo-*` skill declarations in the frontmatter, a
 * "Persist learnings" bullet in the prose, and a numbered `memo-save` step
 * the overlay may insert into rework-flow.md); the shipped definitions never
 * do. Applied to both sides of a comparison - a no-op for the definitions
 * copy.
 *
 * Four line passes with a small state machine:
 * 1. Drop the "## Memory" section (heading through the next "## " heading).
 * 2. Drop `memo-*` skill declarations from the frontmatter skills list,
 *    matching both the `memo-` delimiter and the legacy colon-delimited form
 *    while the coordinated agents-memo rename rolls out (the colon branch
 *    becomes dead once the deployed overlays regenerate).
 * 3. Drop the "Persist learnings" bullet plus its indented continuation
 *    lines, up to the next sibling bullet or a blank line (end of block).
 * 4. Drop a numbered step whose text mentions the `memo-save` skill (the
 *    local overlay's renumbered save step) plus its indented continuation
 *    lines, then renumber every following numbered step by -1 so the
 *    remaining steps match the definitions copy.
 */
function stripLocalMemoryOverlay(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inMemorySection = false;
  let memoSaveStepRemoved = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // (1) Drop the "## Memory" section (heading to next "## " heading).
    if (/^## Memory\b/.test(line)) {
      inMemorySection = true;
      continue;
    }
    if (inMemorySection) {
      if (/^## /.test(line)) inMemorySection = false;
      else continue;
    }

    // (2) Drop memo- skill declarations from the frontmatter skills list;
    //     also match the legacy colon-delimited form during the rename.
    if (/^\s*-\s*"?memo[-:]/.test(line)) continue;

    // (3) Drop the "Persist learnings" bullet and its continuation lines
    //     (indented prose) until the next sibling bullet or end of block.
    if (/^\s*-\s*\*\*Persist learnings\.\*\*/.test(line)) {
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^\s*-\s/.test(next)) break; // sibling bullet
        if (/^\s*$/.test(next)) break; // blank line ends the block
        i++;
      }
      continue;
    }

    // (4) Drop a numbered step mentioning the memo-save skill - the local
    //     overlay's renumbered save step in rework-flow.md - plus its
    //     continuation lines, then renumber every following numbered step
    //     so the remaining steps match the definitions copy. Also match the
    //     legacy colon-delimited form during the rename.
    if (/^\d+\. .*memo[-:]save/.test(line)) {
      memoSaveStepRemoved = true;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^\d+\. /.test(next)) break; // next numbered step
        if (/^\s*$/.test(next)) break; // blank line ends the block
        i++;
      }
      continue;
    }

    // After a removed memo-save step, renumber subsequent numbered steps
    // by -1 (the definitions copy never carries the extra step).
    const stepMatch = memoSaveStepRemoved ? line.match(/^(\d+)\. /) : null;
    if (stepMatch) {
      out.push(line.replace(/^\d+/, String(Number(stepMatch[1]) - 1)));
      continue;
    }

    out.push(line);
  }
  const result = out.join("\n");
  // A Memory section dropped at EOF swallows the doc's final newline (the
  // trailing empty element from split); restore it so the comparison is not
  // tripped by a meaningless trailing-newline difference.
  return markdown.endsWith("\n") && !result.endsWith("\n") ? result + "\n" : result;
}

/**
 * Read a UTF-8 file with an existence guard: a missing file must fail the
 * enclosing test with an actionable message naming the file (a bare ENOENT
 * thrown before the expect wrapper evaluates would report a generic error).
 */
function readGuardrailFile(filePath: string, message: string): string {
  expect(fs.existsSync(filePath), message).toBe(true);
  return fs.readFileSync(filePath, "utf-8");
}

// The legacy flow-scoped naming this guardrail protects against (e.g.
// implement + the shared set_flow_param name). Built from parts so the
// repo-wide grep gate for the scoped naming stays clean — the guardrail
// itself must not re-introduce the literal it polices.
const FLOW_SCOPED_SET_PARAM_SUFFIX = "_set_flow_" + "param";

describe("flow docs guardrails", () => {
  // The flow-scoped set_flow_param routines were replaced by one shared
  // global tool (PR #218 rework). These tests keep the flows and their
  // orchestrator personas from regressing to flow-scoped names.
  //
  // The guarded flow list is derived dynamically instead of hardcoded so a
  // new flow under definitions/ is guarded automatically. It reuses the
  // runtime's own discovery (FlowRegistrar calls discoverFlowDirectories on
  // the flows dir), filters to directories that actually contain flow.json,
  // and sorts so the toEqual assertion against loadedFlows is deterministic.
  let guardrailFlowDirs: string[] = [];
  const guardrailSpecsDir = path.join(__dirname, "..", "agents", "specifications", "templates");

  let loadedFlows: FlowDefinition[] = [];
  let orchestratorDocs: string[] = [];

  beforeAll(async () => {
    const specManager = new SpecManager(new SpecRegistry(), new SpecLoader());
    await specManager.loadFromDirectory(guardrailSpecsDir);
    const definitionsDir = path.join(__dirname, "definitions");
    guardrailFlowDirs = (await discoverFlowDirectories(definitionsDir))
      .filter((name) => fs.existsSync(path.join(definitionsDir, name, "flow.json")))
      .sort();
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

  it("guardrail discovers the shipped flows", () => {
    // Guard against silent coverage loss: discoverFlowDirectories returns []
    // on error, so a deleted flow dir (or a moved definitions/) would make
    // every dynamic guardrail below pass vacuously. Pin the four canonical
    // flows as a MINIMUM set - new flows may be added, but removals must
    // fail loudly instead of shrinking the guardrail to nothing.
    expect(guardrailFlowDirs).toEqual(
      expect.arrayContaining(["implement", "review", "verify", "resolve-pr-feedback"]),
    );
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
      const tools = parseFrontmatterList(markdown, "tools");
      expect(tools, `flow "${guardrailFlowDirs[i]}" has no tools list`).toContain("set_flow_param");
      const flowScopedTools = tools.filter((tool) => tool.endsWith(FLOW_SCOPED_SET_PARAM_SUFFIX));
      expect(
        flowScopedTools,
        `flow "${guardrailFlowDirs[i]}" lists flow-scoped tools: ${flowScopedTools.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("tracked .forge runtime copies mirror the definitions (only the model line may diverge)", () => {
    // The tracked .forge/flows copies are the local runtime versions of the
    // shipped flow definitions (scaffolded by forge-setup.js and updated in
    // lockstep). The one intentional divergence is the orchestrator model
    // override; every other file must be byte-identical - the unhardened gh
    // reply commands in an older resolve-pr-feedback copy predating PR #233
    // showed exactly how silently drifting copies regress.
    const forgeFlowsDir = path.join(__dirname, "..", "..", "..", "..", ".forge", "flows");
    for (const flowName of guardrailFlowDirs) {
      const defDir = path.join(__dirname, "definitions", flowName);
      const forgeDir = path.join(forgeFlowsDir, flowName);

      // orchestrator.md: byte-identical apart from the frontmatter model line.
      const defDoc = readGuardrailFile(
        path.join(defDir, "orchestrator.md"),
        `flow "${flowName}" definitions orchestrator.md is missing`,
      );
      const forgeDoc = readGuardrailFile(
        path.join(forgeDir, "orchestrator.md"),
        `flow "${flowName}" .forge orchestrator.md is missing`,
      );
      const withoutModel = (doc: string) =>
        doc.split("\n").filter((line) => !line.startsWith("model: "));
      // Strip the local memory overlay from BOTH sides before comparing - a
      // no-op for the definitions copy, which never carries it.
      const comparable = (doc: string) => stripLocalMemoryOverlay(withoutModel(doc).join("\n"));
      expect(
        comparable(forgeDoc),
        `flow "${flowName}" .forge orchestrator diverges from the definitions copy`,
      ).toEqual(comparable(defDoc));

      const defModel = defDoc.split("\n").find((line) => line.startsWith("model: "));
      const forgeModel = forgeDoc.split("\n").find((line) => line.startsWith("model: "));
      expect(defModel, `flow "${flowName}" definition must declare the "smart" preset`).toBe(
        'model: "smart"',
      );
      if (forgeModel !== defModel) {
        expect(forgeModel, `flow "${flowName}" .forge copy may only override to "dumb"`).toBe(
          'model: "dumb"',
        );
      }

      // flow.json is executable content and must be byte-identical.
      expect(
        readGuardrailFile(
          path.join(forgeDir, "flow.json"),
          `flow "${flowName}" .forge flow.json is missing`,
        ),
        `flow "${flowName}" .forge flow.json diverges from the definitions copy`,
      ).toBe(
        readGuardrailFile(
          path.join(defDir, "flow.json"),
          `flow "${flowName}" definitions flow.json is missing`,
        ),
      );

      // references/ prose is compared after stripping the local memory
      // overlay (a numbered memo-save step the overlay may insert into
      // rework-flow.md); existence is checked in both directions.
      const defRefsDir = path.join(defDir, "references");
      const forgeRefsDir = path.join(forgeDir, "references");
      if (fs.existsSync(defRefsDir)) {
        for (const ref of fs.readdirSync(defRefsDir)) {
          expect(
            fs.existsSync(path.join(forgeRefsDir, ref)),
            `flow "${flowName}" .forge reference "${ref}" is missing`,
          ).toBe(true);
          expect(
            stripLocalMemoryOverlay(
              readGuardrailFile(
                path.join(forgeRefsDir, ref),
                `flow "${flowName}" .forge reference "${ref}" is missing`,
              ),
            ),
            `flow "${flowName}" .forge reference "${ref}" diverges from the definitions copy`,
          ).toBe(
            stripLocalMemoryOverlay(
              readGuardrailFile(
                path.join(defRefsDir, ref),
                `flow "${flowName}" definitions reference "${ref}" is missing`,
              ),
            ),
          );
        }
      }
      // Reverse direction: a reference present only in .forge is stale cruft
      // the runtime would keep loading - flag it explicitly.
      if (fs.existsSync(forgeRefsDir)) {
        for (const ref of fs.readdirSync(forgeRefsDir)) {
          expect(
            fs.existsSync(path.join(defRefsDir, ref)),
            `flow "${flowName}" .forge has unexpected reference "${ref}"`,
          ).toBe(true);
        }
      }
    }

    // The runtime tree also carries the flow schema copy (scaffolded by
    // forge-setup.js) - it must stay byte-identical to the definitions copy.
    expect(
      readGuardrailFile(
        path.join(forgeFlowsDir, "flow-schema.json"),
        ".forge flow-schema.json is missing",
      ),
      ".forge flow-schema.json diverges from the definitions copy",
    ).toBe(
      readGuardrailFile(
        path.join(__dirname, "flow-schema.json"),
        "definitions flow-schema.json is missing",
      ),
    );
  });

  describe("stripLocalMemoryOverlay", () => {
    it("drops the ## Memory section from heading to next heading", () => {
      const input = [
        "# Orchestrator",
        "",
        "## Memory",
        "- note one",
        "- note two",
        "",
        "## Rules",
        "- rule",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe("# Orchestrator\n\n## Rules\n- rule");
    });

    it("drops a trailing ## Memory section to the end of the doc", () => {
      const input = ["# Orchestrator", "## Memory", "- note"].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe("# Orchestrator");
    });

    it("preserves the doc's trailing newline when the Memory section runs to EOF", () => {
      const input = "# Orchestrator\n## Memory\n- note\n";
      expect(stripLocalMemoryOverlay(input)).toBe("# Orchestrator\n");
    });

    it("drops memo- skill declarations from the frontmatter skills list", () => {
      const input = [
        "---",
        'id: "implement-orchestrator"',
        'model: "smart"',
        "skills:",
        '  - "notes-md"',
        '  - "memo-save"',
        "  - memo-query",
        "tools:",
        "  - set_flow_param",
        "---",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe(
        [
          "---",
          'id: "implement-orchestrator"',
          'model: "smart"',
          "skills:",
          '  - "notes-md"',
          "tools:",
          "  - set_flow_param",
          "---",
        ].join("\n"),
      );
    });

    it("strips the legacy colon-delimited overlay forms during the rename", () => {
      // Built from parts so the repo-wide colon-delimiter grep gate stays
      // clean - the helper must keep tolerating the deployed colon-form
      // overlay until the agents-memo rename regenerates it.
      const colon = ":";
      const input = [
        "---",
        "skills:",
        `  - "memo${colon}save"`,
        "---",
        "",
        `4. Run the \`memo${colon}save\` skill to persist the session's learnings.`,
        "5. Call `destroy_workspace(workspace)` to release the worktree.",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe(
        [
          "---",
          "skills:",
          "---",
          "",
          "4. Call `destroy_workspace(workspace)` to release the worktree.",
        ].join("\n"),
      );
    });

    it("drops the Persist learnings bullet with its continuation lines", () => {
      const input = [
        "1. Do the thing.",
        "2. Then this:",
        "   - **Persist learnings.** Run the `save` skill to file the",
        "     session's learnings into the vault (best-effort).",
        "   - Call `destroy_workspace(workspace)` to release the worktree.",
        "3. Post a summary.",
      ].join("\n");
      const out = stripLocalMemoryOverlay(input);
      expect(out).not.toContain("Persist learnings");
      expect(out).not.toContain("save` skill to file the");
      expect(out).toContain("destroy_workspace");
      expect(out).toContain("Post a summary");
    });

    it("leaves docs without an overlay untouched", () => {
      const input = [
        "---",
        'id: "review-orchestrator"',
        'model: "smart"',
        "skills:",
        '  - "notes-md"',
        "---",
        "",
        "## Rules",
        "- rule",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe(input);
    });

    it("removes a numbered memo-save step and renumbers the following steps", () => {
      const input = [
        "4. Run the `memo-save` skill (see the implement orchestrator's \"Memory",
        "   (memo- skills)\" section) to persist the session's learnings into",
        "   project memory. Best-effort - skip if the `memo-` skills are",
        "   unavailable.",
        "5. Call `destroy_workspace(workspace)` to release the worktree.",
        "6. Post a summary of what was pushed, referencing the existing PR number.",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe(
        [
          "4. Call `destroy_workspace(workspace)` to release the worktree.",
          "5. Post a summary of what was pushed, referencing the existing PR number.",
        ].join("\n"),
      );
    });

    it("removes the indented continuation lines of the memo-save step", () => {
      const input = [
        "3. Push to the existing PR branch:",
        "   ```bash",
        "   git push origin <rework_branch>",
        "   ```",
        "   If push fails, report the error to the user.",
        "4. Run the `memo-save` skill to persist the session's learnings.",
        "   This continuation line must go too.",
        "5. Call `destroy_workspace(workspace)` to release the worktree.",
        "6. Post a summary of what was pushed, referencing the existing PR number.",
      ].join("\n");
      const out = stripLocalMemoryOverlay(input);
      expect(out).not.toContain("memo-save");
      expect(out).not.toContain("continuation line must go too");
      expect(out).toContain("git push origin <rework_branch>");
      expect(out).toContain("4. Call `destroy_workspace(workspace)` to release the worktree.");
      expect(out).toContain(
        "5. Post a summary of what was pushed, referencing the existing PR number.",
      );
    });

    it("is a no-op when no numbered memo-save step exists", () => {
      const input = [
        "4. Call `destroy_workspace(workspace)` to release the worktree.",
        "5. Post a summary of what was pushed, referencing the existing PR number.",
      ].join("\n");
      expect(stripLocalMemoryOverlay(input)).toBe(input);
    });
  });
});

# Plan — Flow Architecture (routine-based)

> [!IMPORTANT]
> **Maintenance Policy**: This is a living implementation roadmap.
>
> 1. **Update before build**: This file must be updated _before_ starting any non-trivial feature implementation to ensure the current plan is explicit.
> 2. **Sync with ADRs**: When a decision here is superseded, record the a change in a new ADR and update this plan immediately.
> 3. **Track Progress**: Update the implementation order checkboxes (Section 7) as tasks are merged.
>
> **What this document is**: the authoritative implementation plan for the flow subsystem...
>
> **What replaced the old `docs/flow-engine.md`:** that file described the
> obsolete single-tool architecture (one `run_implement_loop` tool, a
> top-level `orchestrator { spec, task }` singleton delivered once, a
> `FlowEngine.execute` that ran the whole `steps` array including a final
> `cleanup` that destroyed the workspace before the LLM could open a PR).
> It has been removed. This `PLAN.md` + `UPDATED_FLOW_ARCHITECTURE.md`
> are the only current design docs for the flow subsystem.

---

## 1. Goal

A general-purpose engine that lets a user author an **agentic flow in JSON**:
ordered steps, loops, agents, parallel/sequential composition, and the
**main conversation (the main pi instance) prompt/agent**. `/implement` is
the first flow, not the definition of the system.

## 2. Architectural principle (one line)

The main pi session (an LLM driving a tool loop) **is** the orchestrator. The
flow JSON is a package: one `orchestrator.prompt` (+ tool-active-set) for the
main session, plus named **deterministic routines**; each routine becomes a
Pi tool the LLM calls in whatever order it judges. FlowEngine merely
**executes one routine** and returns a structured blob. Recurrent
main-session handoff is achieved for free by the natural tool-call cadence
— no custom await-reply machinery (pi's `ExtensionAPI` has no await-reply).

Full rationale, worked example, and dependency/execution/user-flow charts:
see `UPDATED_FLOW_ARCHITECTURE.md`.

## 3. Foundation (reused unchanged)

Agent abstraction/lifecycle, `AgentSpecification` + `SpecRegistry`/`SpecLoader`,
IPC (`ParentSocketServer`/`ChildSocketClient`), `WorkspaceProvider` +
`WorktreeRegistry`, `CommandRegistry`/`ToolRegistry` (gains `registerInstance`),
prompt/spec template loading. These already exist and are not under question.

## 4. Flow package shape

```
flows/<name>/
├── flow.json          # name, command, orchestrator, routines
├── orchestrator.md    # main-session persona (referenced by flow.json)
└── (optional) *.md    # per-routine agent task templates
```

`flow.json` (conceptual):

```jsonc
{
  "name": "implement",
  "command": "/implement",
  "orchestrator": {                          // honest: a prompt + tools, NOT a fake spec
    "prompt": "orchestrator.md",
    "tools": ["run_build_loop", "open_pr", "destroy_workspace", "bash"]
  },
  "routines": {                              // each routine -> one registered Pi tool
    "run_build_loop":     { "params": [...], "steps": [ ... ] },
    "open_pr":            { "params": [...], "steps": [ ... ] },
    "destroy_workspace":  { "params": [...], "steps": [ ... ] }
  }
}
```

A routine's `steps` use the deterministic verbs: `workspace`, `agent`,
`parallel`, `loop`, `cleanup`, plus new `git`/`shell` (so a routine can
produce a committed, pushed, PR-able state).

A routine returns a `RoutineResult` blob the LLM ingests:

```ts
interface RoutineResult {
  routine: string;
  passed: boolean;
  rounds?: number;
  workspace?: string; // named worktree path
  results: Record<string, InstructionResult>;
  summary: string;
}
```

## 5. Concrete components to build

1. **`RoutineExecutor`** — runs one routine's `steps` to completion, returns
   `RoutineResult`. No long-lived process, no yield protocol. Depends only
   on the foundation + step executors.
2. **`RoutineTool`** — `ToolDefinition` adapter; `execute(params)` calls
   `RoutineExecutor.run(routineName, params)`. One instance per routine,
   registered via `ToolRegistry.registerInstance`.
3. **`ToolRegistry.registerInstance(tool)`** — instance-based registration.
4. **`OrchestratorCommand`** (generic) — loads `orchestrator.prompt` into the
   main session (`sendUserMessage`), applies `tools` if declared, returns.
5. **`StepExecutorRegistry`** (open) — built-in executors register at init:
   `agent`, `parallel`, `loop`, `workspace`, `cleanup`, `git`/`shell`.
6. **`git`/`shell` step executors** — commit/branch/push/`gh pr create`.
7. **Named workspaces** + `workingDir: { workspace: id }`; `WorkspaceManager`
   selects provider by the `workspace` step's `provider` (make the field real,
   or a provider registry).
8. **`specInput`** on the `agent` instruction — name→value map filling spec
   template slots (`{{TASK}}`/`{{FEEDBACK}}`…) instead of stuffing everything
   into `task`.
9. **Single placeholder/template resolver** — one convention (lowercase
   `{{prompt}}` _or_ uppercase `{{TASK}}`) across spec-loader, flow, and
   orchestrator prompt; never both.
10. **`FlowLoader`** (v2) — loads a flow _package_, two-phase validation
    (schema + semantics), per-file resilient `loadAll` (one bad flow doesn't
    brick init), paths resolved via `import.meta.url` + a build asset-copy
    step (`flows` ship to `dist/flows`).

These reuse `FlowContext` immutability, the TypeBox schemas, the sandboxed
expression parser/Evaluator, and `extractJson` (extended to two JSON shapes:
review/verify findings + build outcome, per ADR 0003).

## 6. Settled decisions (from the earlier D1–D9; see ADRs)

| #   | Question                                | Decision (carried into this plan)                                                                                            |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D1  | Main session external vs placeable step | **External**, by design — pi has no await-reply. Conversational logic = markdown prompt, not JSON `turn` steps.              |
| D2  | Tool handoff boundary                   | **Routine granularity** — one routine per tool; LLM calls them in sequence.                                                  |
| D3  | Workspace model                         | **Named workspaces**; `workingDir: {workspace: id}`; real `provider`.                                                        |
| D4  | Cleanup ownership                       | A **`destroy_workspace` routine** called after `open_pr`; resources survive across routine calls.                            |
| D5  | Loop history                            | **Retain history** per iteration (`history.<id>[i]`) alongside latest `results.<id>`.                                        |
| D6  | Branching                               | **Across routines:** the LLM branches on `RoutineResult` per the prompt. **Within routines:** `branch` instruction deferred. |
| D7  | Agent step model                        | Keep single-shot `executeTask`; add **`specInput`** name→value pass-through.                                                 |
| D8  | Step-type extensibility                 | Open **`StepExecutorRegistry`** from day one; built-ins register at init.                                                    |
| D9  | Expression language scope               | Boolean property paths; small additions (`length`, `==`) optional.                                                           |

ADR 0001 (orchestrator-prompt-lives-in-flow-json) is **superseded** — its
"embedded `orchestrator.task` string" model is replaced by `orchestrator.prompt`
(a referenced markdown file) + `tools`. The "one prompt, one resolver"
principle it captured still holds. ADRs 0002 (schema accuracy + semantic
validation), 0003 (loop gate on builder outcome + typed `toolParams`), and
0004 (loader resilience + packaging) **remain valid** and carry into this
plan; their detailed section pointers now resolve to this `PLAN.md` §5 and
`UPDATED_FLOW_ARCHITECTURE.md` §4–7 rather than the removed `docs/flow-engine.md`.

## 7. Implementation order

Write the executor **after** the contract settles (U2–U5), to avoid rewriting
it under ourselves — see watch-out.

```
U1  Settle the contract: flow package, RoutineResult, routine params schema  [design]   ⬜
U2  StepExecutorRegistry (open); register built-in executors                  [infra]    ⬜
U3  Named workspaces + workingDir-by-ref + real provider selection            [resource] ⬜
U4  git/shell step executor (PR-able state)                                   [resource] ⬜
U5  Resolver unification + specInput on agent                                  [agent]    ⬜
U6  RoutineExecutor (one-routine runner) + RoutineResult                      [core]     ⬜
U7  RoutineTool + ToolRegistry.registerInstance                                [activation]⬜
U8  OrchestratorCommand (load prompt + setActiveTools) + index.ts wiring       [activation]⬜
U9  Per-routine + round-trip drift-guardrail tests                             [tests]    ⬜
  ✅ means done, ⬜ means todo
```

## 8. `/implement` under this plan (target)

```
flows/implement/orchestrator.md      # "clarify → plan → run_build_loop → open_pr → destroy_workspace"
flows/implement/flow.json:
  routines:
    run_build_loop     steps: [ workspace, loop(build ∥ review+verify, continueWhile on builder+review+verify passed) ]
                         (NO cleanup — workspace survives)
    open_pr            steps: [ git add-and-commit, git push-current, shell gh pr create --cwd {{workspace}} ]
    destroy_workspace  steps: [ cleanup of={{workspace}} ]
```

Walked end-to-end in `UPDATED_FLOW_ARCHITECTURE.md` §4 (incl. user/swimlane chart).

## 9. Deferred (kept small to protect the goal)

`dispatch`/fire-and-forget result collection; step timeouts; resume from
checkpoint; a `branch` instruction _inside_ routines (LLM covers it across
routines); full expression language with functions; mid-routine main-session
handoff (**not supported** — split a routine into two and let the LLM call
them in sequence).

## 10. Doc map (so it stops being confusing)

| Document                                 | Role                                                                              | Status                          |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------- |
| `PLAN.md` (this file)                    | Authoritative implementation plan + decision summary + tracker                    | current                         |
| `UPDATED_FLOW_ARCHITECTURE.md`           | Rationale, worked example, dependency/execution/user-flow charts                  | current                         |
| `docs/adr/0001-…orchestrator…md`         | "One orchestrator prompt, one resolver" (now via `orchestrator.prompt`+`tools`)   | **Superseded** (principle kept) |
| `docs/adr/0002-…schema…md`               | Schema accuracy + semantic validation completeness (parseJson, workingDir, specs) | Valid                           |
| `docs/adr/0003-…loop-gate…md`            | Loop gates on builder outcome; typed `toolParams`                                 | Valid                           |
| `docs/adr/0004-…loader…md`               | Loader resilience + flow asset packaging                                          | Valid                           |
| ~~`docs/flow-engine.md`~~                | Old single-tool detailed design — contradicted by the routine model               | **Removed**                     |
| ~~`src/agents/prompts/orchestrator.md`~~ | Legacy manual-spawn orchestrator prompt — deleted in working tree                 | Removed                         |

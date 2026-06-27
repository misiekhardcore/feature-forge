# Updated Flow Architecture

> **Status:** Proposed redesign. Supersedes the "FlowEngine owns the whole
> agentic flow" model in `PLAN.md` §3–7 and `docs/flow-engine.md`.
>
> **One-line summary:** Stop building an engine that drives the conversation.
> The main pi session (an LLM driving a tool loop) _is_ the orchestrator.
> The flow JSON becomes a package: one **orchestrator prompt** (the main
> conversation persona) plus a set of named **deterministic routines**,
> each exposed to the LLM as a Pi tool. The LLM calls routines in any
> order it likes; FlowEngine merely _executes one routine_ and returns a
> structured blob.
>
> This document gives the rationale, the shape, worked examples, and ASCII
> charts for dependencies, execution, and user flow.

---

## 1. Why we're redesigning

The prior plan put a `FlowEngine` in the driver's seat: the LLM plans once,
calls a single `run_implement_loop` tool, the engine runs the _entire_ `steps`
array to completion (workspace → build loop → cleanup), then returns a blob.
To make that "general" we'd need the engine to model the main conversation
as a placeable, repeatable "turn" step and to hand control back to the LLM
mid-flow.

We checked pi's actual extension API
(`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`):
an extension can **push** a message into the session (`sendUserMessage`,
`sendMessage({ triggerTurn })`) but there is **no "await the session's next
reply"**. A tool handler is a blocking call during which the main session is
_blocked on that very tool_. So a blocking engine tool cannot, mid-execution,
pause, let the LLM answer, and resume — that requires building await-reply +
event-correlation machinery pi does not provide. Fighting the platform.

**The realization:** every tool call a pi session makes is _already_ an LLM
turn. The LLM already does "call a deterministic thing → read its result →
decide what to do next" for free. We were about to rebuild that, badly,
inside FlowEngine. The design should ride pi's grain, not sit on top of it.

So the redesign is **not** "add a `turn` instruction". It is: **let the LLM
hold the conversational state; make the engine a deterministic subroutine
runner exposed as tools.**

---

## 2. The architectural shift, in one table

| Concern                              | Prior plan                              | This design                                                               |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| Who drives the agentic flow          | `FlowEngine` (engine owns state)        | The main pi session (LLM owns state)                                      |
| What FlowEngine does                 | Runs the whole `steps` array, one-shot  | Runs **one routine's** `steps`, returns a blob                            |
| How many tools per flow              | One (`run_implement_loop`)              | One per routine (N tools)                                                 |
| Recurrent main-session handoff       | Unmodelled (one big tool call)          | Free — each routine call is a turn                                        |
| Branching ("if review failed retry") | `branch` instruction or `continueWhile` | The LLM branches by choosing the next tool call                           |
| Where the conversational logic lives | (would be) structured JSON `turn` steps | A markdown orchestrator prompt                                            |
| Where the deterministic logic lives  | JSON `steps`                            | JSON `steps` (unchanged)                                                  |
| Workspace lifetime                   | Destroyed by final `cleanup` step       | Survives routine calls; cleanup is its own routine called after `open_pr` |
| Custom await-reply machinery needed  | Yes (and impossible on pi's API)        | No                                                                        |

**Trade-off, stated honestly:** the _conversational_ logic (when to ask the
user, when to retry, how to phrase the summarization) lives in a markdown
prompt, not in structured JSON. That is correct: that part is genuinely LLM
judgment, and forcing it into JSON was the prior plan's category error. The
_deterministic skeleton_ — the part that actually benefits from being
declarative and replayable — stays JSON.

---

## 3. The shape of a flow package

One flow = one directory (or one JSON file with a referenced prompt). For
clarity we use a directory:

```
flows/implement/
├── flow.json            # declarative definition: orchestrator prompt + routines
├── orchestrator.md      # the main-session persona (referenced by flow.json)
└── (optional) *.md      # per-routine agent task templates
```

### 3.1 `flow.json` schema (conceptual)

```jsonc
{
  "name": "implement",
  "command": "/implement",

  // The "main conversation prompt/agent" — declarable, and honest.
  // A prompt (+ optional tool-active-set) for pi's main session.
  // NOT a fake AgentSpecification / spec.
  "orchestrator": {
    "prompt": "orchestrator.md",
    "activeTools": ["run_build_loop", "open_pr", "bash"],
  },

  // Named deterministic subroutines. EACH becomes a registered Pi tool.
  "routines": {
    "run_build_loop": {
      "params": [
        { "name": "task", "description": "The task description" },
        { "name": "plan", "description": "The implementation plan" },
      ],
      "steps": [
        /* workspace, loop, ... */
      ],
    },
    "open_pr": {
      "params": [
        { "name": "workspace", "description": "Worktree path from run_build_loop result" },
        { "name": "title", "description": "PR title" },
      ],
      "steps": [
        /* commit, branch, gh pr create */
      ],
    },
    "destroy_workspace": {
      "params": [{ "name": "workspace", "description": "Worktree path to release" }],
      "steps": [
        /* cleanup: destroy the named worktree */
      ],
    },
  },
}
```

### 3.2 A routine's `steps`

Identical to today's `steps`, **scoped to one routine**. The same five
deterministic verbs: `workspace`, `agent`, `parallel`, `loop`, `cleanup`.
Plus (mandatory regardless of design) a small set that can actually produce
a PR-able state:

- `git` (or specific `commit` + `branch`) — required so the worktree is
  committable before `gh pr create`.
- `shell` — run `gh pr create`, run tests, etc. (One generic `shell` step
  covers `commit`/`branch`/`gh`; keep the vocabulary small.)

### 3.3 What the routine returns

A `RoutineResult` blob — serializable, the LLM reads it and decides:

```ts
interface RoutineResult {
  routine: string; // which routine ran
  passed: boolean; // top-level success
  rounds?: number; // for loops
  workspace?: string; // named worktree path
  results: Record<string, InstructionResult>; // per-step outputs
  summary: string; // human-readable digest the LLM ingests
}
```

The orchestrator prompt instructs the LLM to call routines based on these
fields, e.g. "call `open_pr` only if `run_build_loop.passed` is true".

---

## 4. Worked example: `/implement` end-to-end

### 4.1 `flows/implement/orchestrator.md`

```markdown
You are the /implement orchestrator.

1. Clarify the task with the user. Produce a short plan.
2. Call `run_build_loop(task, plan)`.
3. Read its result. If `passed` is true, call `open_pr(workspace, title)`.
   If `passed` is false, summarize the remaining findings to the user and ask
   whether to retry; if yes, call `run_build_loop` again with the failure
   feedback appended to `plan`.
4. After `open_pr` succeeds, call `destroy_workspace(workspace)`.

You may ask the user questions between steps. Do not modify code yourself —
only the routines do. Do not spawn agents directly — routines manage agents.
```

### 4.2 `flows/implement/flow.json` — the `run_build_loop` routine

````jsonc
{
  "name": "implement",
  "command": "/implement",
  "orchestrator": {
    "prompt": "orchestrator.md",
    "activeTools": ["run_build_loop", "open_pr", "destroy_workspace", "bash"],
  },
  "routines": {
    "run_build_loop": {
      "params": [
        { "name": "task", "description": "Task description" },
        { "name": "plan", "description": "Implementation plan" },
      ],
      "steps": [
        { "type": "workspace", "id": "ws", "provider": "git-worktree" },
        {
          "type": "loop",
          "id": "build_loop",
          "maxIterations": 5,
          "continueWhile": "!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed",
          "accumulateFrom": ["review", "verify"],
          "steps": [
            {
              "type": "agent",
              "id": "builder",
              "spec": "build",
              "workingDir": { "workspace": "ws" },
              "parseJson": true,
              "specInput": {
                "TASK": "{{task}}",
                "PLAN": "{{plan}}",
                "FEEDBACK": "{{feedback}}",
                "WORKSPACE": "{{workspace}}",
              },
              "task": "Build per the plan. End with ```json { \"passed\": true|false, \"summary\": \"...\" } ```.",
            },
            {
              "type": "parallel",
              "id": "inspect",
              "steps": [
                {
                  "type": "agent",
                  "id": "review",
                  "spec": "review",
                  "workingDir": { "workspace": "ws" },
                  "parseJson": true,
                  "task": "Review against: {{task}}\nBuild output:\n{{results.builder.raw}}",
                },
                {
                  "type": "agent",
                  "id": "verify",
                  "spec": "verify",
                  "workingDir": { "workspace": "ws" },
                  "parseJson": true,
                  "task": "Verify AC against: {{task}}\nBuild output:\n{{results.builder.raw}}",
                },
              ],
            },
          ],
        },
        // NOTE: NO cleanup here — the workspace outlives this routine.
      ],
    },
    "open_pr": {
      "params": [{ "name": "workspace" }, { "name": "title" }],
      "steps": [
        { "type": "git", "id": "commit", "action": "add-and-commit", "cwd": "{{workspace}}" },
        { "type": "git", "id": "branch", "action": "push-current", "cwd": "{{workspace}}" },
        {
          "type": "shell",
          "id": "pr",
          "command": "gh pr create --title \"{{title}}\" --body \"See session summary\"",
          "cwd": "{{workspace}}",
        },
      ],
    },
    "destroy_workspace": {
      "params": [{ "name": "workspace" }],
      "steps": [{ "type": "cleanup", "id": "cleanup", "of": "{{workspace}}" }],
    },
  },
}
````

### 4.3 What actually happens at runtime

1. User types `/implement add auth`.
2. `/implement` command loads `orchestrator.md` into the session and sets
   `activeTools`, then returns. The session is now an "implement orchestrator"
   persona.
3. The LLM (main session) clarifies with the user, drafts a plan.
4. The LLM calls tool `run_build_loop(task=..., plan=...)`.
   - `FlowEngine.run("run_build_loop", {task,plan})` executes that routine's
     `steps`: creates a worktree, runs the build→review→verify loop
     deterministically until `continueWhile` is false or 5 rounds.
   - Returns `{ passed, rounds, workspace, results, summary }`.
5. The LLM reads the blob. If `passed`, calls `open_pr(workspace, title)`.
   `open_pr` runs commit/branch/`gh pr create` **in the still-live worktree**.
6. The LLM calls `destroy_workspace(workspace)`; the worktree is released.
7. The LLM posts the PR URL to the user.

Steps 3, 5, 6 are **LLM turns between deterministic routine calls** — pi gives
us this for free via its normal tool-call loop. No "turn instruction", no
await-reply machinery.

---

## 5. Charts

### 5.1 Static dependency graph (who depends on whom)

```
                         ┌──────────────────────────────────────┐
                         │            Foundation (unchanged)     │
                         │  Agent / PiSubprocessAgent            │
                         │  AgentSpecification / SpecRegistry   │
                         │  AgentSupervisor (spawn/execute/     │
                         │    destroy)                           │
                         │  WorkspaceProvider + WorktreeRegistry │
                         │  IPC (ParentSocketServer / Client)    │
                         │  Prompt template + spec loading       │
                         └───────────────────┬──────────────────┘
                                             │ uses
                          ┌──────────────────┴───────────────────┐
                          │          FlowEngine (redesigned)     │
                          │  - RoutineExecutor: runs ONE routine  │
                          │    step-by-step, returns RoutineResult│
                          │  - Step executors registered in a     │
                          │    StepExecutorRegistry (extensible)  │
                          │  - FlowContext (immutable, per-routine)│
                          │  - extractJson (review/verify/build)  │
                          │  - ExpressionEvaluator (continueWhile)│
                          └───────────────────┬──────────────────┘
                                              │ exposed as
                          ┌───────────────────┴───────────────────┐
                          │   RoutineTool (one per routine)       │
                          │   implements Pi ToolDefinition        │
                          │   execute(params) -> FlowEngine.run() │
                          └───────────────────┬──────────────────┘
                                              │ registered in
                          ┌───────────────────┴───────────────────┐
                          │   ToolRegistry.registerInstance(tool) │
                          └───────────────────┬──────────────────┘
                                              │ consumed by
                          ┌───────────────────┴───────────────────┐
                          │   Main pi session (the LLM)           │
                          │   + OrchestratorCommand (loads prompt) │
                          └───────────────────────────────────────┘

  flow package (JSON + md)
        │
        ├──> OrchestratorCommand      (loads orchestrator.md into session)
        ├──> RoutineTool (×N)         (registered at init)
        └──> FlowLoader               (validates flow.json, v2-phase)
```

Key edges:

- FlowEngine depends **only** on the foundation + its own step executors. It
  does **not** know about the LLM, the command, or pi's session — it's a
  pure subroutine executor.
- RoutineTool is the only pi-facing boundary. Small, testable in isolation.
- The LLM is outside the engine. It calls RoutineTools like any other tool.

### 5.2 Execution flow for one routine call

```
LLM/main session
      │  tool_call: run_build_loop(task="...", plan="...")
      ▼
RoutineTool.execute(params)
      │
      ▼
FlowEngine.run("run_build_loop", params)
      │  build FlowContext(task, plan)
      ▼
┌────────────────────────────────────────────────────────┐
│ for step in routine.steps:                             │
│    executor = stepExecutorRegistry.get(step.type)      │
│    ctx      = await executor.execute(step, ctx)        │
│                                                        │
│   workspace ─► creates git worktree, ctx.workspace=... │
│   loop  ──┐                                            │
│           │  iteration i:                              │
│           │    agent builder  ─► supervisor.spawn/      │
│           │                        executeTask/destroy │
│           │    parallel ─► [review, verify]            │
│           │                  supervisor.* concurrently  │
│           │    continueWhile? eval ─► stop or loop     │
│           └──────────────────────────────────────────  │
│   (NO cleanup here — workspace survives)               │
└────────────────────────────────────────────────────────┘
      │
      ▼
RoutineResult { passed, rounds, workspace, results, summary }
      │  returned as tool result
      ▼
LLM/main session  ◄── reads RoutineResult, decides next tool call
                    (open_pr, destroy_workspace, or ask user)
```

Contrast with the prior design, which ran workspace→loop→cleanup inside one
uninterruptible tool call and then destroyed the workspace before the LLM
could open a PR:

```
PRIOR (problematic):
  LLM ─► run_implement_loop ─► [ws, loop, cleanup→DESTROY] ─► blob
  LLM gets blob, has NO workspace to open_pr from.
```

### 5.3 The user flow (swimlane)

```
USER            MAIN SESSION (LLM)            FLOWENGINE / ROUTINES         PI/EXTENSION
────            ────────────────────          ─────────────────────        ────────────
/implement ────►                                                          /implement
  "add auth"        │                                                       command
                   │ load orchestrator.md + setActiveTools ◄─────────────── load flow.json
                   │                                                       register routine tools
  clarify ◄────────┤
  answer ─────────►
                   │ plan
                   │ tool_call run_build_loop(task,plan) ───────────────► FlowEngine.run
                   │                                              ┌─────── create worktree ──► agent builder
                   │                                              │ loop  parallel [review,verify]
                   │                                              │       (continueWhile→stop)
                   │                                              └─────── (no cleanup)
                   │ ◄── RoutineResult {passed, workspace, ...} ─────────
                   │
                   │ if passed: tool_call open_pr(workspace,title) ────► commit, branch, gh pr create
                   │ ◄── RoutineResult {prUrl} ─────────────────────────
                   │ tool_call destroy_workspace(workspace) ─────────► cleanup (release worktree)
  PR link ◄────────┤
done
```

The dashed boxes show where the **LLM regains control** between deterministic
routines — exactly the recurrent main-session handoff the prior plan could
not express, now achieved with zero custom machinery: it's just pi's normal
tool-call cadence.

### 5.4 "Two regimes" that were conflated — now separated

```
REGIME A: LLM-driven conversation            REGIME B: deterministic pipeline
(unchanged pi behaviour)                      (FlowEngine)

 clarify → plan → call routine A             routine A: workspace → loop → agents
                └► ingest result ─► call B   routine B: git commit → push → gh pr create
                       └► summarize          routine C: cleanup
                                                     ▲
                                                     │  exposed as routine tools
  LLM owns this ─────────────────────────────────────┘  Engine owns this
  (markdown orchestrator prompt)                       (JSON steps)
```

The prior plan tried to express Regime A _as JSON steps inside_ the same
engine that runs Regime B. This design keeps them separate by construction:
the engine only ever runs Regime B; Regime A is the LLM being the LLM.

---

## 6. Authoring generality — the actual goal

The user wants to "define steps, loops, agents, parallel/sequential steps,
and the main conversation prompt/agent in JSON." Here's how this design maps:

| Goal capability                          | Where it lives                                                        | Example                                            |
| ---------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| Sequential deterministic steps           | a routine's `steps: []` (ordered)                                     | workspace → loop                                   |
| Loops                                    | `loop` instruction + `continueWhile`                                  | build→review→verify                                |
| Parallel steps                           | `parallel` instruction                                                | review ∥ verify                                    |
| Agents                                   | `agent` instruction + `specInput`                                     | builder agent                                      |
| Main conversation prompt/agent           | flow-level `orchestrator.prompt` (+ tools)                            | `orchestrator.md`                                  |
| Recurrent main-session handoff           | emerges from routine tools (free)                                     | summarize between `run_build_loop` calls           |
| Branching over routine verdicts          | the LLM, per the prompt                                               | "if run_build_loop.passed then open_pr"            |
| Branching inside a routine (future)      | optional `branch` instruction (deferred)                              | —                                                  |
| Extensible step vocabulary               | `StepExecutorRegistry` (open)                                         | register `git`/`shell` step executors              |
| Resource (workspace) identity & lifetime | named workspaces; `workingDir: {workspace: id}`; cleanup is a routine | `open_pr` uses ws; `destroy_workspace` releases it |

A user authors a flow by writing:

1. one `orchestrator.md` describing how the LLM should drive the routines,
2. some number of routines, each a JSON `steps` array,
3. `flow.json` registering command + orchestrator + routine param schemas.

They get the deterministic skeleton declaratively and the conversational
judgment as a prompt — each in its natural medium.

---

## 7. Comparison with `PLAN.md` open decisions (D1–D9)

- **D1 main session external vs placeable** → settled: it is external (a
  prompt + tool-active-set) **by design**, because pi can't await-reply.
  Recurrent handoff is achieved via routine tools instead. Drop the `turn`
  instruction idea.
- **D2 tool handoff boundary** → settled: routine granularity. The LLM calls
  one routine tool at a time; multiple turns between deterministic phases
  are natural.
- **D3 workspace model** → named workspaces, `workingDir: {workspace: id}`,
  real `provider` in `WorkspaceManager` (or a small provider registry). Keep
  the recommendation.
- **D4 cleanup ownership** → a `destroy_workspace` routine the LLM calls
  after `open_pr`. Resources survive across routine calls.
- **D5 loop history** → keep the recommendation (`history: ...` per
  iteration). Useful inside a routine.
- **D6 branching** → outside routines: the LLM branches on `RoutineResult`
  fields. Inside routines: `branch` instruction deferred (not load-bearing).
- **D7 agent single-shot + `specInput`** → keep `executeTask` single-shot;
  add `specInput` name→value pass-through so spec template slots are filled,
  not duplicated into `task`.
- **D8 step-type extensibility** → `StepExecutorRegistry`, open from day
  one; built-ins (`agent`/`parallel`/`loop`/`workspace`/`cleanup`/`git`/`shell`)
  register at init.
- **D9 expression language** → keep boolean property paths; small additions
  (`length`, `==`) optional.

---

## 8. What is NOT new / reused unchanged

- Foundation layer (agents, specs, IPC, worktree, registries).
- `FlowContext` immutability, `FlowLoader` two-phase validation, the
  sandboxed expression parser, `extractJson`.
- TypeBox schema validation.
- The five deterministic instruction shapes — now scoped to a routine.

## 9. What is genuinely new to build

1. **`RoutineExecutor`** (the lean `FlowEngine`): takes a flow + routine name
   - params, runs that routine's `steps`, returns `RoutineResult`. No
     long-lived process, no yield protocol.
2. **`RoutineTool`**: `ToolDefinition` subclass adapting `RoutineExecutor.run`
   to pi. One instance per routine, registered via `registerInstance`.
3. **`ToolRegistry.registerInstance(tool)`** — already a todo; required.
4. **`OrchestratorCommand`** (generic): loads `orchestrator.prompt` into the
   session via `sendUserMessage`, sets `activeTools` if declared, returns.
5. **New step executors** for `git` / `shell` (or one generic `shell` that
   covers both), registered in `StepExecutorRegistry`. Required so a
   routine can produce a committed, pushed, PR-able state.
6. **Named workspace refs** + `workingDir: {workspace: id}`; `WorkspaceManager`
   selection by `provider`.
7. **`specInput`** on the `agent` instruction + the single shared
   placeholder/template resolver (lowercase or uppercase — pick one).
8. **Flow packaging**: directory form (`flow.json` + `orchestrator.md`);
   `FlowLoader` loads a flow package; flows resolved via `import.meta.url` +
   a build asset-copy step (so flows ship to `dist/flows`).
9. **Drift guardrail test**: for every shipped flow package, round-trip
   every prompt/template through the resolver and assert no `{{…}}`
   survivors; assert all `spec` references exist; assert `continueWhile`
   parses and evaluates against stubbed results.

## 10. Honestly deferred

- `dispatch` / fire-and-forget result collection.
- Step timeouts. Resume from checkpoint.
- A `branch` instruction inside routines (the LLM covers most needs across
  routines; revisit if a deterministic routine genuinely needs internal
  branching).
- A full expression language (functions, list ops).
- Mid-routine main-session handoff — explicitly **not supported**; each
  routine runs to completion. Users who want a user decision mid-flow should
  split the routine into two and let the LLM call them in sequence.

---

## 11. Implementation order (revised)

```
U1  Settle the contract: flow package shape, RoutineResult, params schema  [design]
U2  StepExecutorRegistry (open); register built-in executors               [infra]
U3  Named workspaces + workingDir-by-ref + real provider selection         [resource model]
U4  git/shell step executor (so routines can produce PR-able state)         [resource model]
U5  Spec resolver unification + specInput on agent                          [agent fit]
U6  RoutineExecutor (one-routine runner) + RoutineResult                   [core]
U7  RoutineTool + ToolRegistry.registerInstance                             [activation]
U8  OrchestratorCommand (load prompt + setActiveTools) + index.ts wiring     [activation]
U9  Per-routine + round-trip guardrail tests                                 [drift-prevention]
```

Write `RoutineExecutor` (U6) **after** U2–U5, _not_ before — so its contract
is the final one and we don't rewrite it under ourselves (prior watch-out).

## 12. Decision needed from you

The only thing this design commits to that you should contest explicitly:

> The **conversational** part of "agentic flow" lives in a markdown
> orchestrator prompt, and the LLM drives routine-tool calls in whatever
> order it judges right. The JSON does **not** encode the conversation
> sequence.

If you want the JSON to _enforce_ the conversation sequence (e.g. "must
plan, then must loop, then must summarize, no skipping, even if the LLM
would otherwise skip"), that is a different requirement — deterministic
control over talk — and we'd revisit whether to add back a weak resumable
engine, accepting we must build await-reply on top of pi's event API. For
the stated goal ("user defines steps/loops/agents/parallel + main
conversation prompt") I believe the answer above suffices and is the
lowest-risk path on pi.

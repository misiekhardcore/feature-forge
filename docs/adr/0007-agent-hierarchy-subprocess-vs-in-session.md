# ADR 0007: Agent hierarchy — subprocess vs in-session

**Date:** 2026-07-02
**Status:** Accepted

## Amendment 2026-08-16 — agents list/viewer is a subprocess-agent presentation surface

The fleet presentation contract is pinned: every surface that lists, streams,
or destroys agents is a **subprocess-agent surface**. In-session personas
(`SessionAgent`) are deliberately invisible to it.

- **Kind discriminator.** The base `Agent` gains `kind: AgentKind` with
  `AgentKind = "subprocess" | "in-session"` (`src/agents/agents/Agent.ts`);
  concretes pin it with `as const` (`PiSubprocessAgent` → `"subprocess"`,
  `SessionAgent` → `"in-session"`). The TUI mirrors the type locally and the
  `AgentQuery` projection in `packages/tui/src/api.ts` carries `kind` next to
  `id`, `specification`, `status`, and `createdAt`, so presentation consumers
  can filter on the family without narrowing.
- **List/viewer surfaces filter on the discriminator.**
  `AgentViewerOverlay.wireOverlayEvents` connect seeding skips any agent whose
  `kind !== "subprocess"` — this covers the overlay and `/agent:list`, which
  share the wiring. The IPC path is guarded too:
  `ParentSocketServer.handleListAgents` returns `kind === "subprocess"` entries
  only, since socket clients are sibling subagents, not the live session.
- **One overlay owner.** `showAgentViewer`
  (`packages/cli/src/agents/showAgentViewer.ts`) is the single composer owning
  the agent-viewer overlay lifecycle (wire → `ctx.ui.custom` → connect →
  dispose/dismiss); `RoutineTool`, `AgentListCommand`, and the dev test
  commands in `registerTestCommands` all delegate to it instead of inlining
  the overlay. The debug loop routine is the one deliberate exception:
  `registerTestLoopRoutine` receives a plain `createOverlay` constructor
  factory from `registerTestCommands` and drives the overlay instance itself
  (it owns its own `ctx.ui.custom` wiring, so there is nothing to hand off).
  Only one overlay is ever open per process: a module-scope singleton entry
  in `showAgentViewer.ts` (the contract assumes all callers import the same
  bundled module instance — they do). While a viewer is open (or still
  opening), a further invocation never calls `ctx.ui.custom` again — it
  reuses the existing overlay, refocusing it via pi's `OverlayHandle.focus()`
  (captured through `ctx.ui.custom`'s `onHandle`), and receives a handle to
  the same instance whose `dispose` is a no-op, so a reusing caller (e.g. a
  routine's unconditional finally-dispose) can never tear down an overlay it
  did not open; the reusing caller's wiring/setup/`onDismiss` params are
  ignored. The returned handle is a point-in-time snapshot of the active
  viewer: taken before the factory may have run, `viewer` can be `undefined`
  and the promise resolves immediately rather than on dismissal. The
  singleton is released on dispose, creation errors, and headless resolution,
  so the next invocation opens fresh.
- **Persona history is the pi session transcript.** An in-session persona's
  conversation is persisted by pi itself (session JSONL); forge never writes
  viewer stream files (`.stream`, `.events.jsonl`, `.messages.jsonl`) for it.
  Those files are keyed to subprocess agent ids and remain the subprocess
  presentation's storage.
- **No new in-session status.** Resolution E's revision holds: the in-session
  family reuses `Spawned` / `Running` / `Cancelled`, and the presentation needs
  no new member — an in-session persona never appears in the viewer, so there
  is no in-session-only status for fleet consumers to special-case.
- **Terminal states are lossless.** `AgentDisplayHelpers.mapAgentStatus` is an
  exhaustive switch over `AgentStatus` with a 1:1 vocabulary: `Spawned` →
  `"started"`, `Running` → `"running"`, `Completed` → `"done"`, `Failed` →
  `"error"`, `Cancelled` → `"cancelled"` (backed by the dedicated
  `CancelledAgentEntry` type). A destroyed subprocess agent renders as
  `"cancelled"`; no terminal state collapses into another.
- **Destroy paths are kind-guarded.** `AgentDestroyCommand` refuses
  `kind !== "subprocess"` with a pointer to `/forge:flow:exit`;
  `AgentDestroyAllCommand` filters `kind === "subprocess"` before destroying;
  `ParentSocketServer.handleDestroyAgent` rejects non-subprocess agents via the
  `kind` discriminator (consistent with `handleListAgents` and the commands;
  `isSubprocessAgent` stays reserved for narrowing where `executeTask` /
  `getResult` is actually invoked). The supervisor's base-typed `destroyAgent`
  is unchanged — `AgentSupervisor.destroyAll` was removed (zero callers, and
  blanket-destroying would violate the kind contract) — and every surface that
  reaches destroy is guarded, so in-session personas are torn down only through
  their own path (flow exit).

The original decision record below is left intact as history.

## Amendment 2026-08-03 — remove the `InSessionAgent` intermediate

The abstract `InSessionAgent` intermediate was removed. `SessionAgent` now
`extends Agent` directly, and `mount(pi, task)` is a public method on the
concrete `SessionAgent` rather than an abstract contract on an intermediate.
`AgentSupervisor.mountInSession(spec)` returns `Promise<SessionAgent>`.

Rationale: the intermediate existed to host the in-session interaction
contract (`mount`) and to mark the extension point for future in-session
concretes. After the refactor it has exactly one consumer — `SessionAgent`
itself. Keeping an abstract class with a single concrete subclass added a
file, an indirection, and a barrel export without a second implementer to
justify it. The interaction contract is preserved exactly where it is used:
`mount` on the concrete `SessionAgent`.

The Interface Segregation argument from the original decision still holds:
`mount` is **not** promoted to the base `Agent` (which would force a no-op
contract onto `SubprocessAgent`); it stays on the in-session family, which now
has a single concrete member. The original decision record below is left
intact as history.

## Context

Before this change there was no structural relationship between `Agent` and
`OrchestratorAgent`:

- `Agent` was abstract and extended by `PiSubprocessAgent`, but the base was
  shaped entirely around the **subprocess / RPC** model — `executeTask()`,
  `getResult()`, `getError()`, and an agent-owned `deliverResult()` /
  `deliverError()` push back into the parent session.
- `OrchestratorAgent` did **not** extend `Agent`. It had a different API
  (`create()` + `mount(pi, ctx)`), a different persona source (orchestrator
  markdown + frontmatter, not an `AgentSpecification`), and a different
  consumption path (`OrchestratorCommand`, not `AgentSupervisor`). It is
  **in-session**: it injects into the current pi conversation via
  `before_agent_start`, `sendUserMessage`, and `setActiveTools`.

So the "base" `Agent` was really a subprocess contract masquerading as the
general abstraction. The asymmetry was real and confusing.

### Conceptual root cause

We conflated two different things under the word "orchestrator":

- The **Orchestrator** = the _deterministic process following a flow file_
  (`RoutineExecutor`, `StepExecutor`, `FlowContext` — "Regime B"). This is
  **not an LLM, not an Agent.**
- An **Agent** = an LLM with a persona. The class previously called
  `OrchestratorAgent` is just an _in-session Agent_ given an
  "orchestrator-role" persona and driving the deterministic Orchestrator via
  routine tools.

Naming an LLM class `OrchestratorAgent` was the category error that produced
the confusion. This refactor fixes both the structural gap _and_ the naming.

## Decision

### Target hierarchy

```
Agent                          (abstract base — truly common contract)
├── SubprocessAgent            (abstract — separate process / RPC transport)
│   └── PiSubprocessAgent      (concrete — pi RPC subprocess; params via CLI args)
└── InSessionAgent             (abstract — runs inside the current pi session)
    └── SessionAgent           (concrete — LLM persona loaded into the live session;
                                takes AgentSpecification, like its subprocess sibling)
```

`Agent` = an LLM with a persona. `Orchestrator` ≠ Agent/LLM — it is the
deterministic flow-follower. The class formerly named `OrchestratorAgent` is
renamed `SessionAgent` (concrete) under the `InSessionAgent` (abstract)
intermediate; it is role-neutral — a future non-orchestrator in-session persona
reuses the same class.

> **Naming scope:** concrete = `SessionAgent`, abstract = `InSessionAgent`
> (avoids the file/barrel collision of two same-named classes). The
> flow-package vocabulary (`flow.orchestrator`, `orchestrator.md`,
> `OrchestratorCommand`) is a **separate, larger naming sweep** — flagged but
> _not_ blocked on this refactor.

### What is truly common vs per-family

**Base `Agent`** keeps the truly common denominator: `id`, `specification`,
`createdAt`, `status`, and `destroy()`. Everything subprocess-specific
(`executeTask`, `getResult`, `getError`, `deliverResult`, `deliverError`,
`start`) moves down to `SubprocessAgent`; the in-session contract
(`mount(pi, task)`) lives on `InSessionAgent`. `AgentSpecification` is on the
base — it is the persona _input_, common to both families (every concrete is
constructed from one, §G), so fleet consumers read `agent.specification.role`
directly without a guard. Only the _interaction_ contracts are
per-family — those live on the respective `SubprocessAgent` / `InSessionAgent`.

`deliverResult` / `deliverError` live **only on `SubprocessAgent`**: they exist
solely because a _separate_ subprocess must report back to the parent session.
An in-session agent **is** the parent conversation, so a "deliver back" step is
semantically nonsense for it.

### `AgentStatus` per-family states

| State       | Subprocess          | In-session               |
| ----------- | ------------------- | ------------------------ |
| `Spawned`   | after construction  | after `new SessionAgent` |
| `Running`   | after `start()`     | after `mount(pi, task)`  |
| `Completed` | after `executeTask` | —                        |
| `Failed`    | on error            | —                        |
| `Cancelled` | after `destroy`     | after `destroy`          |

### Spec construction decoupled from agent running

`OrchestratorAgent.create(flow, flowDir)` previously coupled building the persona
(reading `orchestrator.md` + frontmatter) with constructing the agent. These
split:

- A **`FlowSpecLoader`** reads `flow.orchestrator.systemPrompt` markdown +
  frontmatter and produces a `DynamicAgentSpecification` (no `pi` dependency).
  (This role is now served by the unified `SpecLoader` — see the “Spec loading
  unification” addendum below.)
- **`new SessionAgent(spec)`** is pure construction from a spec, identical in
  shape to `new PiSubprocessAgent(id, spec, rpcClient)`.

The persona source is bundled with the flow (`orchestrator.md` co-located with
`flow.json`), but loaded by the shared `SpecLoader` and resolved **by spec name**
through `SpecManager` — symmetric with sub-agent specs. The runtime task
template (`flow.orchestrator.prompt`) is resolved to a plain `task` string
by the command **before** `mount(pi, task)`, symmetric to
`executeTask(prompt)`. This removes the routine engine's `FlowContext` from the
Agent surface entirely (it stays a routine-engine internal).

### Consumption models: unified fleet, distinct interaction

The **fleet lifecycle** is unified in `AgentSupervisor`; the **interaction
model** stays distinct. Both families share one tracking map, **both entrypoints
keyed on `AgentSpecification`**:

- `spawnGuest(spec): Promise<SubprocessAgent>` — subprocess path (delegates to
  `AgentFactory`).
- `mountInSession(spec): Promise<InSessionAgent>` — `new SessionAgent(spec)` +
  register. The caller then calls `agent.mount(pi, task)`.
- `getAgent` / `getAllAgents` / `destroyAgent` / `destroyAll` operate over the
  base `Agent`.

`runAgent` stays a **subprocess-only convenience** (one-shot
spawn → `executeTask` → `getResult` → `deliverResult` → destroy), typed against
`SubprocessAgent`. It is _never_ called for an in-session agent — those go via
`mountInSession` / `mount` / `destroy`.

The two interaction paths cannot collapse under `executeTask`: subprocess agents
produce a discrete awaited string and report back; in-session agents drive the
live conversation across multiple turns with no single string to return. We
unify _identity + lifecycle_; we keep _interaction_ family-specific.

### What `Agent` exposes vs what lives on the intermediates

The base exposes identity and origin — `id`, `specification`, `createdAt`,
`status`, and `destroy()` — shared verbatim by every concrete agent. The
**interaction** contracts are what stay family-specific: `executeTask`,
`getResult`, `getError`, `deliverResult`, `deliverError`, and `start` live on
`SubprocessAgent`; `mount(pi, task)` lives on `InSessionAgent`. This keeps
Interface Segregation honest: the slim base never forces a no-op
`executeTask`/`deliverResult` onto an in-session agent, nor a no-op `mount`
onto a subprocess agent.

`specification` is _not_ interaction — it is the persona input, common to
both families (every concrete agent is constructed from an
`AgentSpecification`, §G). Promoting it to the base lets fleet consumers
(`AgentListCommand`, the IPC list-agents path) read `agent.specification.role`
directly with no guard. Consumers that _do_ need the interaction methods on a
base-typed `Agent` (e.g. the IPC send-task path) still narrow with
`isSubprocessAgent`; the now-redundant `getRole` accessor was removed.

## Resolved decisions (A–H)

- **A** — Move the in-session LLM class into `src/agents/agents/`. **Yes.**
- **B** — Supervisor role: unify the fleet lifecycle; keep `runAgent`
  subprocess-specific.
- **C** — `deliverResult`/`deliverError` live on `SubprocessAgent` only.
- **D** — In-session agents are tracked in the supervisor. **Yes, unify.**
- ~~**E** — `AgentStatus` on the base; add a `Mounted` member (table above)~~.
  Revised: no new `Mounted` state — the in-session family reuses `Running`
  ("persona+task mounted into the live session") to avoid a second
  in-session-only status that fleet consumers would have to special-case.
- **F** — Conceptual split: Orchestrator ≠ Agent/LLM. **Confirmed.**
- **G** — In-session agent input type: `AgentSpecification` (same as
  subprocess); `flow`/`flowDir` are spec sources; prompt template resolved to a
  plain `task` string before `mount`.
- **H** — Concrete = `SessionAgent`, abstract = `InSessionAgent`.

## Consequences

- `src/agents/orchestrator/` is removed; its file moves to `agents/` for
  symmetry with `PiSubprocessAgent`.
- `FlowContext` no longer appears anywhere under `src/agents/` (grep guard).
- `OrchestratorCommand` resolves the orchestrator spec **by name** through
  `SpecManager` (same path as sub-agent specs), resolves the prompt inline,
  and drives the live session via `mountInSession` + `mount`.
- One in-session concrete exists today (`SessionAgent`); a second is deferred per
  Open/Closed (the extension point is `InSessionAgent`).

### Spec loading unification

Follow-up to the original §9 scope guardrails (which deferred touching
`flow.orchestrator` / `orchestrator.md` / `OrchestratorCommand`). There is now
**one** spec-loading path:

- `SpecLoader` (in `src/loaders/`) is a stateless single-file parser: it reads
  markdown-with-frontmatter and produces a `ParsedSpec` via
  `SpecLoader.load(absolutePath)`. It knows nothing about directories or
  orchestration; its only concern is `file → SpecFactory`.
- `SpecManager` owns both the `SpecRegistry` and the orchestration of how specs
  get into it. It exposes two loaders:
  - `loadFromDirectory(specsDir)` scans the directory for `*.md` files and calls
    `SpecLoader.load(file)` for each one, registering the result under its
    frontmatter `id`. Used for the declarative sub-agent specs at startup.
  - `loadFile(absolutePath)` calls `SpecLoader.load(path)` once and registers the
    result. Available for single-file registration when directory scanning is not
    appropriate.
- Both registration paths end up in the **same** `SpecRegistry`, keyed on the
  frontmatter `id` (not the filename stem). So `declarative-specs/build.md`
  (`id: "build"`) and a flow's `orchestrator.md` (`id: "implement"`) are filed
  identically.
- `flow.orchestrator.systemPrompt` is now a **spec name** (`"implement"`),
  symmetric with how `flow.json` agent steps already reference sub-agent specs
  (`"build"`, `"review"`, `"verify"`). The orchestrator markdown stays
  co-located with its flow (so editing a flow keeps its persona beside
  `flow.json`); `FlowRegistrar` loads all `*.md` specs in the flow directory via
  `SpecManager.loadFromDirectory` before the `OrchestratorCommand` is registered.
- `FlowSpecLoader` is deleted; the persona-file → `AgentSpecification` parsing
  it duplicated is now `SpecLoader`'s job.

**Tool declaration divergence is intentional.** Spec frontmatter declares
tooling one of two ways, and exactly one must be present:

- `toolPreset: "fullAccess"` — a named `TOOL_PRESETS` subset of **built-in**
  tools (used by sub-agent specs like `build.md`).
- `tools: [run_build_loop, open_pr, bash]` — an explicit list, used by specs
  that name **extension/routine tools** that are not built-in-tool preset
  members (e.g. an orchestrator persona). Forcing these through a preset would
  be a category error; presets model built-in tool subsets, not routines.

# ADR 0007: Agent hierarchy — subprocess vs in-session

**Date:** 2026-07-02
**Status:** Accepted

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
- **`new SessionAgent(spec)`** is pure construction from a spec, identical in
  shape to `new PiSubprocessAgent(id, spec, rpcClient)`.

`flow` / `flowDir` are _spec sources_, not the agent's input type. The runtime
task template (`flow.orchestrator.prompt`) is resolved to a plain `task` string
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
- `OrchestratorCommand` builds the spec via `FlowSpecLoader`, resolves the
  prompt inline, and drives the live session via `mountInSession` + `mount`.
- One in-session concrete exists today (`SessionAgent`); a second is deferred per
  Open/Closed (the extension point is `InSessionAgent`).

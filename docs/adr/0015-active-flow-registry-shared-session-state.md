# ADR 0015: Active-flow routing for shared session-state tools (`set_flow_param`)

**Date:** 2026-08-16
**Status:** Accepted

## Context

Every flow used to register a routine tool literally named `set_flow_param`
into the one shared `ToolRegistry`. Both registries (tool and routine) are
name-keyed, so `registerInstance` throws on duplicates and only the
first-registered flow's tool survived — bound to *that* flow's `RoutineExecutor`
and `FlowStateStore` — while the other flows' registrations failed silently.
Any other flow's persona that called `set_flow_param` then wrote into the
wrong flow's store (the D1 collision).

Plan option (a) — declaring a flow-scoped `set_flow_param` routine in each
`flow.json` — shipped in PR #218 (`<flow>_set_flow_param` ids). It fixed the
collision but was reworked after PR feedback:

- flow-scoped names leak an implementation detail into every persona's tool
  list (each `orchestrator.md` had to list its flow's private routine id);
- it departs from the original intent: session params belong to the **flow
  session**, not to a flow-specific registration artifact. Sub-flows inlined
  via routine refs already share the parent's store (ADR 0011), so the shared
  tool matches that model — one store per active flow session, one name to
  refer to it.

## Decision

One shared `set_flow_param` tool, registered globally in `index.ts` as a
sibling of `set_session_name` (before `FlowRegistrar` runs), routing writes
through a new `ActiveFlowRegistry`:

- `ActiveFlowRegistry` is a single-slot pointer (`flowName` + `FlowStateStore`).
- `OrchestratorCommand` calls `setCurrent` only **after** a successful mount
  (most recent mount wins).
- `/flow:exit` calls `clear()` on **every** successful exit (including the
  no-agents branch); a failed or aborted exit leaves the pointer intact.
- With no active flow, the tool fails with an actionable error
  ("no active flow — start a flow first (e.g. /forge:implement)") — never a
  silent no-op.
- After a successful write the tool emits `feature-forge:session-set` on the
  shared event bus, for display parity with the routine-based path it
  replaces.

## Consequences

- **Single registration path** for the builtin tool: one `registerInstance`
  call in `index.ts`, no per-flow routine declarations. The builtin
  `set_flow_param` registration path (and its dedicated try/catch) was
  removed; the per-routine-tool registration try/catch remains and silently
  skips (warn) any third-party routine whose id collides with the shared tool
  name.
- **Per-flow stores remain the ownership unit**: `RoutineExecutor` and
  `OrchestratorCommand` share the same `FlowStateStore` instance per flow, so
  values persist across the active flow's routine calls and resolve via
  `{{session.*}}`.
- **Third-party flows** may still declare their own routine-based
  `set_flow_param`: a routine declaring the same id collides with the shared
  global tool and is silently skipped (caught + warn); a different id works
  fine and remains supported. The builtin is the default surface.
- **Subprocess sessions have no active flow** — the tool errors if invoked
  there; in practice it never is, because subprocess specs do not list it.
- **Known limitation**: with multiple simultaneously mounted personas, only
  the most recently mounted flow's store receives writes. This matches the
  conversation-focus reality (the latest flow command is the active one) and
  is documented, not silently spread across stores.

## References

- ADR 0007 — Agent hierarchy: subprocess vs in-session (flow execution model)
- ADR 0011 — Flow composition: inline flattening (shared parent store)
- Source: `packages/cli/src/orchestrator/ActiveFlowRegistry.ts`,
  `packages/cli/src/tools/SetFlowParamTool.ts`, `packages/cli/src/index.ts`,
  `packages/cli/src/commands/OrchestratorCommand.ts`,
  `packages/cli/src/commands/FlowExitCommand.ts`

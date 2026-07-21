# ADR 0011: Flow Composition — Inline Flattening

## Status

Accepted

## Context

PR #139 introduced cross-flow routine references with a `type: "routine"` instruction that spawned a child `RoutineExecutor` with an isolated `FlowContext`. This design required:

1. Picking one specific routine from the target flow (via `routine` field)
2. Explicit `input` passing and result aggregation between parent/child contexts
3. Caller knowledge of internal routine names
4. `target` using a command string (e.g. `/review`) rather than the flow name

The design worked but was overly complex. Flows should compose as a unit — when a flow references another flow, all its routines should run inline, sharing the parent's context, results map, and `{{token}}` resolution.

## Decision

Replace isolated child-executor composition with **inline flattening**: a `type: "routine"` instruction inlines all routines from the target flow into the parent `FlowContext`, as if the sub-flow's steps were declared directly in the parent.

### Key changes

1. **`routines` becomes an array** with an `id` field per routine (`RoutineDefinition[]` instead of `Record<string, RoutineDefinition>`). This provides explicit ordering and removes reliance on JS object key insertion order.

2. **`RoutineRefInstruction` simplified**: only `target` (flow name) and `output_as` (optional). Removed: `routine`, `input`, `timeout`, `on_error`.

3. **`target` uses flow `name`**, not `command`. Not every flow has a command; `name` is the stable identifier.

4. **Inline execution**: steps from the target flow's routines execute directly in the parent's `FlowContext`, sharing the same `FlowStateStore`, results map, params, and `{{token}}` resolution. No child `RoutineExecutor`.

5. **Step ID namespacing**: inlined step IDs are prefixed as `{flowName}.{stepId}` to prevent collisions with parent step IDs.

6. **Depth tracking**: `FlowContext` carries a `depth` field (default 0), incremented by 1 for inlined groups. `MAX_NESTING_DEPTH` (default 10) guards against infinite recursion.

7. **Sub-flow orchestrator ignored**: the orchestrator is only relevant for LLM-driven command invocation, not `type: "routine"` references.

8. **Shared `flowMap`**: a `Map<string, FlowDefinition>` keyed by flow `name` is populated by `FlowRegistrar` and passed to `RoutineRefStepExecutor` via `StepExecutorRegistry`.

## Rationale

| Problem with v1 | Solution in v2 |
|---|---|
| Force-picks one routine from target flow | All routines run as a unit — the whole flow |
| Isolated `FlowContext` requiring input/output marshalling | Shared context — no param passing needed |
| `routine` field couples caller to internal names | Only `target` (flow name) needed |
| `target` uses command string | Uses flow `name`, the stable identifier |
| Record iteration order not guaranteed | Array with explicit ordering |
| No recursion guard | Depth counter prevents infinite loops |

## Consequences

- **Positive**: Simpler composition model; less surface area for bugs; composable flows feel native.
- **Positive**: No context isolation means results from inlined steps are immediately available via `{{results.review.review}}` etc.
- **Negative**: Migration from Record to array requires touching all flow JSON files and all code that iterates routines.
- **Negative**: Step ID namespacing changes result keys — downstream code referencing `{{results.review}}` may need updating.

## Alternatives considered

- **Keep Record but add `order` field**: rejects the structural guarantee; arrays are the standard for ordered data.
- **Continue with child executor but pass parent context**: still complex; the executor adds no value when there's no isolation boundary.
- **Hybrid: inline only for single-routine flows**: adds a special case; uniform behavior is easier to reason about.

# Implementation Plan: Flow Composition v2 — Inline Flattening

## Problem

PR #139 implemented cross-flow routine references by having a `type: "routine"` instruction point to a **specific routine** within a target flow (`target` + `routine` fields), then spinning up a child `RoutineExecutor` with an isolated `FlowContext`. This design has fundamental issues:

1. **Forces picking one routine** — flows typically have multiple routines that should all run together as a unit.
2. **Isolated execution context** — the child routine gets its own `FlowContext`, `FlowStateStore`, and param resolution, requiring explicit `input` passing and result aggregation.
3. **`routine` field coupling** — the caller must know internal routine names of the sub-flow.
4. **`target` uses command string** — `/review` instead of flow name `review`; not every flow has a command.
5. **`routines` is a `Record`** — relies on implicit JS object key insertion order for iteration.

## New Architecture: Inline Flattening

A `type: "routine"` instruction references a **target flow** (by name, not command). At execution time, the executor **inlines all routines** from the target flow — their steps are injected directly into the parent's `FlowContext` as if they were copied from the sub-flow. No child `RoutineExecutor`, no isolated context, no param passing.

```
Parent flow (implement)              Sub-flow (review)              Sub-flow (verify)
┌──────────────────────────┐         ┌────────────────────┐         ┌────────────────────┐
│ type: "routine"          │         │ routines: [        │         │ routines: [        │
│   id: "call-review"      │  ──→    │   { id: "inspect", │         │   { id: "check",   │
│   target: "review"       │         │     steps: [...] } │         │     steps: [...] } │
│                          │         │ ]                  │         │ ]                  │
│ type: "routine"          │  ──→    └────────────────────┘         └────────────────────┘
│   id: "call-verify"      │
│   target: "verify"       │   Steps from review's routines are inlined
└──────────────────────────┘   into parent context with namespaced IDs:
                                review.review, review.<stepId>, etc.
```

### Key design decisions

| Decision | Rationale |
|---|---|
| `routines` becomes an array with `id` per routine | Explicit ordering, no reliance on JS key insertion order |
| `target` uses flow `name` (not `command`) | Not every flow has a command; name is the stable identifier |
| `routine` field removed from `RoutineRefInstruction` | Sub-flows run as a whole — all routines, all steps |
| Steps inlined into parent `FlowContext` | Same `FlowStateStore`, params, results map, `{{token}}` resolution — no child executor |
| Step IDs namespaced as `{flowName}.{stepId}` | Prevents collision between parent and sub-flow step IDs |
| `input`, `timeout`, `on_error` removed from `RoutineRefInstruction` | Not needed — steps run directly in parent context |
| `depth` incremented by 1 for the inlined group | Guards against infinite recursion; same depth for all inlined steps |
| Sub-flow orchestrator ignored | Orchestrator only relevant for LLM-driven command invocation, not for `type: "routine"` |

---

## Implementation phases

### Phase 1: Change `routines` from `Record` to array

**Files:**
- `FlowInstruction.ts` — `RoutineDefinitionSchema` gains `id: Type.String({ minLength: 1 })`; `FlowDefinitionSchema.routines` changes from `Type.Record(Type.String(), ...)` to `Type.Array(...)`
- `FlowDefinition` type — `routines: RoutineDefinition[]` instead of `Record<string, RoutineDefinition>`
- `RoutineDefinition` type — add `id: string` field
- `RoutineParamSchema` — add `required: Type.Optional(Type.Boolean())` (already done in PR #139)
- All flow JSON files — convert from object-keyed routines to array with `id`:
  - `implement/flow.json`
  - `review/flow.json`
  - `verify/flow.json`
- `FlowRegistrar.ts` — iterate `flow.routines` as array, register each as `RoutineTool` using `routine.id` as the tool name
- `RoutineTool.ts` — constructor receives `routineDef` which now has `id`; use `routineDef.id` for tool name
- `RoutineExecutor.ts` — `.run(routineId, ...)` looks up routine by `flow.routines.find(r => r.id === routineId)`
- `createSetFlowParamTool.ts` — no changes needed (uses `RoutineTool` with definition override)
- `flow-schema.json` — regenerate
- `generate-flow-schema.ts` — update to emit array-based routines schema

**Migration:** Every reference to `flow.routines[name]` or `Object.entries(flow.routines)` must change to `flow.routines.find(r => r.id === id)` or `flow.routines.forEach(...)` / `flow.routines.map(...)`.

### Phase 2: Create `RoutineRefInstruction`

**Files:**
- `FlowInstruction.ts` — `RoutineRefInstructionSchema`:
  ```typescript
  defineInstruction("routine", {
    target: Type.String({ minLength: 1 }),  // flow name, not command
    output_as: Type.Optional(Type.String({ minLength: 1 })),
  })
  ```
  Remove: `routine`, `input`, `timeout`, `on_error`
- `RoutineRefInstruction` type — derives from schema automatically
- `FlowInstruction.test.ts` — update schema validation tests

### Phase 3: Create `RoutineRefStepExecutor` for inline flattening

**Files:**
- `FlowContext.ts` — add `depth: number` field (defaults to 0) and `withDepth(n: number): FlowContext` mutation method
- `executors/MaxDepthExceededError.ts` — new error class, thrown when `MAX_NESTING_DEPTH` is exceeded
- `executors/RoutineRefStepExecutor.ts` — new executor implementing `execute()`:
  1. Look up target flow by `instruction.target` in `flowMap` (keyed by flow name)
  2. Depth guard: `context.depth + 1 >= MAX_NESTING_DEPTH` → throw `MaxDepthExceededError`
  3. Emit `routine-ref-start` with `{ instructionId, target, flow }`
  4. For each routine in `targetFlow.routines` (in array order):
     - For each step in `routine.steps`:
       - Clone the step with namespaced `id`: `step.id = `${instruction.target}.${step.id}``
       - Execute via the parent's `executeStep` dispatcher (same `FlowContext`, same `eventBus`)
       - If step fails and it's not an AbortError, propagate failure
  5. Emit `routine-ref-done` with `{ instructionId, target, flow, passed }`
  6. Store result in `context.results` under `output_as` (or `instruction.id`)
  7. On error, emit `routine-ref-error` with `{ instructionId, target, flow, stepId }`

- `executors/index.ts` — export new error class and register the executor
- `getDisplayContribution()` — use `event.details` without `routine` field
- `registerDisplayHandler()` — contributed state entry format is `target:flow` instead of `target:routine`
- `executors/RoutineRefStepExecutor.test.ts` — tests for inline behavior

**Result shape:** Since steps run in parent context, individual step results are already in `context.results`. The `type: "routine"` entry in `context.results` stores a summary:
```typescript
{
  parsed: {
    passed: true | false,
    flow: "review",
    routineCount: 2,
    summary: "Flow 'review' inlined 2 routines (4 steps)"
  },
  raw: JSON.stringify({ passed, flow, routines: [...] })
}
```

### Phase 4: Create shared `flowMap` in `FlowRegistrar`

A shared `Map<string, FlowDefinition>` keyed by `flow.name` enables cross-flow
lookup during step execution. The map is populated as flows are discovered and
passed to `RoutineRefStepExecutor` at construction time (e.g. via constructor
injection or `StepExecutorRegistry` registration context).

**Files:**
- `FlowRegistrar.ts` — define `flowMap: Map<string, FlowDefinition>` as a new
  constructor param (alongside `pi`, `specManager`, `knownProviders` from
  #127/#144). Populate it in `registerAll()` after each flow loads:
  ```typescript
  flowMap.set(flow.name, flow);
  ```
  Thread `flowMap` into `RoutineRefStepExecutor` so it can resolve `target`
  flow names at execution time.
- `StepExecutorRegistry.ts` — accept optional context (e.g. `flowMap`) when
  registering executors, or expose a setter for passing runtime context.
- `FlowRegistrar.test.ts` — verify flowMap size and name-keyed lookup

### Phase 5: Add `routine-ref-*` event channels

**Files:**
- `eventBus/channels.ts` — update `routine-ref-*` channel details:
  ```typescript
  "feature-forge:routine-ref-start": {
    phase: "routine-ref-start";
    message: string;
    details: { instructionId: string; target: string; flow: string };
  };
  "feature-forge:routine-ref-done": {
    phase: "routine-ref-done";
    message: string;
    details: { instructionId: string; target: string; flow: string; passed: boolean };
  };
  "feature-forge:routine-ref-error": {
    phase: "routine-ref-error";
    message: string;
    details: { instructionId: string; target: string; flow: string; stepId?: string };
  };
  ```
  Remove `routine` from details. Add `flow` and optional `stepId`.

- `progress/DisplayContribution.ts` — update `RoutineRefContribution`:
  ```typescript
  export interface RoutineRefContribution {
    readonly type: "routine-ref";
    readonly flow: string;      // was: target + routine
    readonly status: "started" | "done" | "error";
    readonly phase: string;
    readonly message: string;
  }
  ```

- `progress/AccumulatedState.ts` — `routineRefs` entries become just `flow` strings

### Phase 6: Create new flow JSON files (`review`, `verify`)

Review and verify agent specs already exist from #147 (spec enrichment with
skill files). These new flow JSON files wrap those specs as standalone flow
routines that can be inlined via `type: "routine"`.

**`review/flow.json`** (new file):
```json
{
  "$schema": "...",
  "name": "review",
  "command": "/review",
  "routines": [
    {
      "id": "inspect",
      "params": [
        { "name": "output", "description": "Raw output from previous step", "required": true },
        { "name": "workspace", "description": "Absolute path to the workspace" }
      ],
      "steps": [
        {
          "type": "agent",
          "id": "review",
          "systemPrompt": "review",
          "workingDir": { "path": "{{workspace}}" },
          "parseJson": true,
          "prompt": "Review the code for quality...\n\nTask:\n{{prompt}}\n\nPrevious step output:\n{{output}}"
        }
      ]
    }
  ]
}
```

**`verify/flow.json`** (keep `check`):
```json
{
  "$schema": "...",
  "name": "verify",
  "command": "/verify",
  "routines": [
    {
      "id": "check",
      "params": [...],
      "steps": [...]
    }
  ]
}
```

**`implement/flow.json`** — routine refs simplified:
```json
{
  "type": "routine",
  "id": "call-review",
  "target": "review",
  "output_as": "review_result"
},
{
  "type": "routine",
  "id": "call-verify",
  "target": "verify",
  "output_as": "verify_result"
}
```
No `routine`, `input`, `timeout`, `on_error` fields. Steps from sub-flow run inline in parent context with access to `{{workspace}}`, `{{results.builder.raw}}`, `{{prompt}}`, etc.

### Phase 7: Update `RoutineTool` for array-based routines

**Files:**
- `RoutineTool.ts` — constructor uses `routineDef.id` for tool name instead of a separate `routineName` param:
  ```typescript
  constructor(flowName: string, routineDef: RoutineDefinition, executor: RoutineExecutor, supervisor: AgentSupervisor) {
    this.name = routineDef.id;
    // ...
  }
  ```
  Update `.run()` call to use `routineDef.id` and the new depth-first signature.

- `FlowRegistrar.ts` — simplify the `RoutineTool` construction:
  ```typescript
  for (const routineDef of flow.routines) {
    const routineTool = new RoutineTool(flowName, routineDef, routineExecutor, supervisor);
    toolRegistry.registerInstance(routineTool);
  }
  ```

### Phase 8: Update `FlowLoader` for array routines

**Files:**
- `FlowLoader.ts` — `walkInstructions` iterates `flow.routines` as array:
  ```typescript
  for (const routine of flow.routines) {
    for (const step of routine.steps) {
      // ... walk instruction tree
    }
  }
  ```
  `collectParseableIds`, `checkAccumulateFrom`, declared workspace scoping all updated.

- `flow-roundtrip.test.ts` — update review/verify additionalParams (no `build_output`, use `output` + `workspace`)

### Phase 9: Regenerate flow schema

**Files:**
- `generate-flow-schema.ts` — update to emit array-based `routines` schema with `id` per routine
- `scripts/validate-flow-json.ts` — update validation logic for array routines
- `flow-schema.json` — regenerate

### Phase 10: Tests

**Unit tests:**
- `RoutineRefStepExecutor.test.ts` — rewrite for inline behavior:
  - Inlines all routines from target flow into parent context
  - Step IDs are namespaced (`review.review`)
  - Depth incremented by 1
  - `routine-ref-start/done/error` events fired with `flow` (not `routine`)
  - No `input`, `timeout`, `on_error` handling
  - Failure in inlined step propagates normally
  - `MaxDepthExceededError` at depth limit

- `FlowInstruction.test.ts` — update `RoutineRefInstructionSchema` tests:
  - Only `target` + `output_as` fields
  - `routine`, `input`, `timeout`, `on_error` are absent from schema
  - `routines` array schema validation with `id`

- `FlowRegistrar.test.ts` — flowMap keyed by name only
- `RoutineExecutor.test.ts` — lookup routine by `id` in array
- `RoutineTool.test.ts` — constructor uses `routineDef.id`
- `FlowLoader.test.ts` — `accumulateFrom` with `type: "routine"` in array routines
- `flow-roundtrip.test.ts` — array-based routine iteration

**E2E tests:**
- `e2e/flow-workspace.e2e.test.ts` — verify inline flattening works end-to-end

### Phase 11: ADR

- `docs/adr/0011-flow-composition-inline-flattening.md` — document:
  - Why `routine` field was removed
  - Why `routines` became an array
  - Why steps are inlined vs. child executor
  - Step ID namespacing strategy

---

## Files affected (summary)

| Category | Files |
|---|---|
| Schema/types | `FlowInstruction.ts`, `FlowDefinition`, `RoutineDefinition` |
| Flow context | `FlowContext.ts` (depth field, `withDepth()`) |
| Executor | `executors/RoutineRefStepExecutor.ts`, `executors/MaxDepthExceededError.ts`, `executors/index.ts` |
| Core engine | `RoutineExecutor.ts`, `RoutineTool.ts`, `FlowRegistrar.ts`, `FlowLoader.ts`, `StepExecutorRegistry.ts` |
| Events | `eventBus/channels.ts`, `progress/DisplayContribution.ts`, `progress/AccumulatedState.ts` |
| Flows | `flows/implement/flow.json`, `flows/review/flow.json`, `flows/verify/flow.json` |
| Schema gen | `generate-flow-schema.ts`, `flow-schema.json`, `validate-flow-json.ts` |
| Tests | All co-located `.test.ts` files, `flow-roundtrip.test.ts` |
| Docs | `docs/adr/0011-flow-composition-inline-flattening.md` |

---

## Acceptance criteria

- [ ] `routines` is an array with `id` per routine — explicit ordering, no Record key reliance
- [ ] `routine` field removed from `RoutineRefInstruction` — only `target` (flow name) + `output_as`
- [ ] `type: "routine"` inlines all routines from the target flow into parent `FlowContext`
- [ ] Inlined step IDs namespaced as `{flowName}.{stepId}` to prevent collisions
- [ ] `input`, `timeout`, `on_error` removed from `RoutineRefInstructionSchema`
- [ ] `target` uses flow `name` — `FlowRegistrar` populates `flowMap` by name only
- [ ] `routine-ref-*` events carry `flow` (not `routine`) in details
- [ ] Depth incremented by 1 for the inlined group
- [ ] Sub-flow orchestrator ignored when referenced via `type: "routine"`
- [ ] `flow-schema.json` regenerated with array-based routines schema
- [ ] All unit and e2e tests pass; lint, format, typecheck clean
- [ ] Coverage thresholds maintained (90% lines, statements, functions, branches)
- [ ] ADR written for the inline flattening design decision
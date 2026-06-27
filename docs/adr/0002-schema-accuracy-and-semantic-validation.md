# ADR 0002: Schema accuracy and semantic validation completeness

**Date:** 2026-06-26
**Status:** Partially superseded 2026-06-27. Sub-decisions **B.1** (drop `provider`) and **B.2** (`workingDir` magic-string union) are **superseded by ADR 0005** — named workspaces with real per-workspace `provider` selection (a `WorkspaceProviderRegistry`) and `workingDir: { workspace: id }` by-name reference. Sub-decisions **C.1** (accumulateFrom → parseJson enforcement) and **C.2** (agent `spec` validated against `knownSpecs`) **remain in force** and carry into the routine model.

## Context

Several fields in the TypeBox schemas were either unconstrained (accepting values that should be rejected) or documented as constrained but not enforced:

1. **`WorkspaceInstructionSchema.provider`** — documented as an optional field on the workspace instruction, suggesting the flow definition could choose between `"git-worktree"` and `"current-dir"`. However, `WorkspaceManager` takes a single `WorkspaceProvider` in its constructor; there is no per-instruction selection mechanism.

2. **`AgentInstructionSchema.workingDir`** — typed as `Type.Optional(Type.String())`, which silently accepts empty strings and gives no indication that the literal `"workspace"` is a magic value that resolves to the flow context's workspace path.

3. **`accumulateFrom` parseJson enforcement** — documented as a required semantic rule (see `PLAN.md` §5), but not implemented at the time. A loop could declare `accumulateFrom: ["builder"]` even when the `builder` agent had no `parseJson: true`, producing garbage feedback at runtime.

4. **Agent spec names unvalidated** — a flow could reference `spec: "nonexistent"` on an agent instruction and the loader would accept it, only to fail at runtime when `SpecRegistry.create()` throws.

## Decision

### B.1 — Remove `provider` from `WorkspaceInstructionSchema`

The workspace instruction schema is now `{ id, type: "workspace" }` — no `provider` field. The provider is wired at extension init time (e.g., `index.ts` constructs `new GitWorktreeProvider(repoRoot)`). Flows do not select the backend.

### B.2 — Make `workingDir` discriminate the `"workspace"` literal

```typescript
workingDir: Type.Optional(Type.Union([Type.Literal("workspace"), Type.String({ minLength: 1 })]));
```

The magic value `"workspace"` is now part of the schema contract — it cannot be confused with a literal directory path. Empty strings are rejected. The engine (future `FlowEngine.ts`) resolves `"workspace"` to `ctx.workspace`.

### C.1 — Enforce `accumulateFrom` targets have `parseJson: true`

`FlowLoader.checkAccumulateFrom()` now collects all ids with `parseJson: true` via a recursive `collectIdsByFlag()` walk. Any `accumulateFrom` target that exists but lacks `parseJson: true` produces a semantic error.

### C.2 — Validate agent specs against a known set

`FlowLoader` accepts an optional constructor parameter `knownSpecs?: ReadonlySet<string>`. When provided, `validateSemantics()` flags any `AgentInstruction` whose `spec` is not in the set. When omitted (CLI usage pre-spec-load), the check is skipped. `SpecRegistry.specNames()` exposes the read-only set.

## Consequences

### Files changed

- `FlowInstruction.ts`: `WorkspaceInstructionSchema` simplified, `AgentInstructionSchema.workingDir` constrained
- `implement.json`: `"provider": "git-worktree"` removed from workspace step
- `flow-schema.json`: regenerated
- `FlowLoader.ts`: `knownSpecs` constructor param, spec validation, `collectIdsByFlag()`, `checkAccumulateFrom()` parseJson enforcement
- `FlowLoader.test.ts`: accumulateFrom tests updated with `parseJson: true`, new rejection/knownSpecs tests
- `FlowInstruction.test.ts`: provider tests removed, workingDir tests added
- `SpecRegistry.ts`: `specNames()` method added
- _(`docs/flow-engine.md` removed 2026-06-27; the design is consolidated in `PLAN.md` §5 and `UPDATED_FLOW_ARCHITECTURE.md` §4–7)_
- `PLAN.md` §5 (components) and §6 (decisions) now carry the relevant spec contracts

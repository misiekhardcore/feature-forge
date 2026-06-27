# ADR 0005: Named workspaces and real provider selection

**Date:** 2026-06-27
**Status:** Accepted
**Supersedes:** ADR 0002 sub-decisions **B.1** (drop `provider` from
`WorkspaceInstructionSchema`) and **B.2** (`workingDir` as a `"workspace"` magic-string union).

## Context

The routine-based flow architecture (see `PLAN.md` and
`UPDATED_FLOW_ARCHITECTURE.md`) makes workspaces a first-class, nameable
resource that can survive across routine calls (created by `run_build_loop`,
consumed by `open_pr`, released by `destroy_workspace`). Two constraints in
the earlier design blocked that:

1. **Single, anonymous workspace.** `FlowContext.workspace` was a scalar and
   `AgentInstructionSchema.workingDir` accepted the literal `"workspace"` as a
   magic value resolved to that one scalar. Two parallel branches could not
   have isolated worktrees, and any resource could be referenced only
   ambiguously as "the workspace".

2. **`provider` was unread.** `WorkspaceInstructionSchema.provider` declared
   `"git-worktree" | "current-dir"`, but `WorkspaceManager` took a single
   `WorkspaceProvider` in its constructor, so the instruction's `provider`
   was never read. ADR 0002 B.1 resolved this contradiction by **dropping**
   the field and wiring one provider at init. That removed the lie but also
   removed the capability: flows could not select a backend, and parallel
   branches that genuinely need different backends (e.g. a git-worktree for
   a builder and `current-dir` for a read-only inspector) had no path.

For a general agentic-flow engine, resource identity and per-resource
backend selection must be expressible by the flow author, not hardcoded by
extension init. ADR 0002 B.1 traded a real capability for surface simplicity.

## Decision

### 1. Workspaces are named resources

A `workspace` instruction creates a workspace and binds it to a name — its
`id`. Resources are referenced **by name**, never by a magic string.

```typescript
{ type: "workspace", id: "ws", provider: "git-worktree" }
```

`FlowContext` tracks a `Map<name, WorkspaceHandle>` (replacing the scalar
`workspace?`). Resolution is by name. Two parallel branches may each create
and reference their own workspace.

### 2. `workingDir` references a workspace by name

Replace the `"workspace"` magic-string union (ADR 0002 B.2) with an explicit
by-name reference:

```typescript
workingDir: Type.Optional(
  Type.Union([
    Type.Object({ workspace: Type.String({ minLength: 1 }) }), // by name
    Type.Object({ path: Type.String({ minLength: 1 }) }), // literal path
  ]),
);
```

The engine resolves `{ workspace: "ws" }` against the named-workspace map
and `{ path: "/abs/..." }` as a literal. The previous magic value
`"workspace"` and its silent-fallback-on-typo behaviour are gone — a name
that does not resolve is a clear semantic error, not a misinterpreted literal
directory.

### 3. `provider` is real: a `WorkspaceProviderRegistry`

Introduce a `WorkspaceProviderRegistry` that maps `provider` identifiers to
`WorkspaceProvider` instances. Built-ins register at init:

```typescript
new WorkspaceProviderRegistry()
  .register("git-worktree", new GitWorktreeProvider(repoRoot))
  .register("current-dir", new CurrentDirProvider());
```

`WorkspaceManager` (or `RoutineExecutor`, depending on where creation is
invoked) looks the provider up by the instruction's `provider` and creates
the workspace. Thus `provider` on the `workspace` instruction is now
**read**, not decorative. ADR 0002 B.1 (drop `provider`) is reversed.

The registry is a **composition mechanism** (per AGENTS.md "Registries"):
it resolves implementations, owns no business logic, and does not create
concrete dependencies internally.

## Consequences

### Schema changes (`FlowInstruction.ts`)

- `WorkspaceInstructionSchema`: `provider` **restored** as a required field
  (`Type.Union([Type.Literal("git-worktree"), Type.Literal("current-dir")])`,
  extensible as the provider registry grows). Reverses ADR 0002 B.1.
- `AgentInstructionSchema.workingDir`: replaced with the
  by-name / by-path discriminated union above. Reverses ADR 0002 B.2.
- `FlowDefinition.toolParams` (ADR 0003 D.2) is unaffected.

### Runtime changes

- New `WorkspaceProviderRegistry`.
- `FlowContext.workspace: string` → `workspaces: Map<string, WorkspaceHandle>`.
  `withWorkspace(name, handle)` / `withWorkspaceCleared(name)` accessor
  discipline (immutability preserved, per the existing value-object contract).
- `RoutineExecutor` (PLAN §5) invokes the registry to create a named
  workspace; `cleanup` / `destroy_workspace` releases a named workspace.
- `resolve()` template for `{{workspace}}` resolves against the _named_
  workspace passed via `specInput`/params (e.g. `{{workspace}}` in a routine
  that received `workspace` as a param), not a global scalar.

### Validation changes (`FlowLoader.ts`)

- Semantic validation: every `workingDir.workspace` name must reference a
  `workspace` instruction id that is in scope (reachable in the same routine,
  or a param of the routine). Unresolved workspace names are a load-time
  error.
- `provider` values must be registered in the provider registry; validation
  accepts an injectable known-provider name set (mirrors the ADR 0002 C.2
  `knownSpecs` injection pattern).
- `implement.json`: the `run_build_loop` workspace step sets
  `provider: "git-worktree"`; the `open_pr` / `destroy_workspace` routines
  receive `workspace` as a param and reference it by name.

### Reversed ADR content

- ADR 0002 B.1 (drop `provider`) — reversed.
- ADR 0002 B.2 (`workingDir` magic-string union) — reversed.
- ADR 0002 C.1 (accumulateFrom → parseJson) and C.2 (agent `spec` against
  `knownSpecs`) remain in force.

## Trade-offs

- A second registry (`WorkspaceProviderRegistry`) alongside `CommandRegistry`
  and `ToolRegistry` adds a small amount of wiring. It is paid back by making
  `provider` honest and by enabling per-branch isolation — both required for
  the stated "general agentic flows" goal.
- The `workingDir` discriminated union is slightly more verbose than a magic
  string, but removes the silent-typo class of bug and makes intent explicit
  in the JSON.

## Status of related ADRs

- **ADR 0001:** still Superseded (orchestrator prompt form is independent of
  workspace identity).
- **ADR 0002:** status refined — B.1/B.2 are now **superseded by this ADR**;
  C.1/C.2 remain valid. Status line updated to point here.
- **ADRs 0003, 0004:** unaffected, remain Accepted.

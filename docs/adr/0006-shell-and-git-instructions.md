# ADR 0006: Git and shell instruction schemas for PR-able routines

**Date:** 2026-06-27
**Status:** Accepted

## Context

The routine-based flow architecture (see `PLAN.md` and `UPDATED_FLOW_ARCHITECTURE.md`)
requires routines to produce a committed, pushed, PR-able state in a git
worktree. Without git and shell instructions, the `open_pr` routine cannot
commit changes or create a pull request — the flow would reach the
orchestrator LLM's "call open_pr" step with no path to actually open a PR.

The prior architecture had no step vocabulary for git operations or arbitrary
shell commands; the `steps` array was limited to `workspace`, `agent`,
`parallel`, `loop`, and `cleanup`.

## Decision

### 1. Add `GitInstruction` to the instruction union

```typescript
export const GitInstructionSchema = defineInstruction("git", {
  action: Type.Union([Type.Literal("add-and-commit"), Type.Literal("push-current")]),
  cwd: Type.String({ minLength: 1 }),
});
```

- **`add-and-commit`** — stages all changes (`git add -A`) and creates a commit
  with the message `"feature-forge: automated changes"`.
- **`push-current`** — pushes the current branch to origin
  (`git push origin HEAD`).
- **`cwd`** — the working directory, supporting `{{workspace.<name>}}`
  placeholder resolution.

The executor uses `child_process.execFile` with a 60-second timeout.
Git operations do not require authentication beyond what the host
environment provides; `gh pr create` is handled by the shell instruction.

### 2. Add `ShellInstruction` to the instruction union

```typescript
export const ShellInstructionSchema = defineInstruction("shell", {
  command: Type.String({ minLength: 1 }),
  cwd: Type.String({ minLength: 1 }),
});
```

- **`command`** — an arbitrary shell command executed via `/bin/sh -c`,
  supporting `{{PLACEHOLDER}}` resolution.
- **`cwd`** — the working directory, supporting `{{workspace.<name>}}`
  placeholder resolution.

The executor uses `child_process.execFile("/bin/sh", ["-c", command])` with
a 120-second timeout and 10 MB max buffer. Non-zero exit codes are caught
and reported as failure results.

### 3. Keep the vocabulary small

Only two new instruction types are added, both primitive (file-system and
process-level). Higher-order operations like `gh pr create` are expressed
as shell commands using these primitives, not as dedicated instruction types.
This keeps the instruction vocabulary bounded while covering the full
PR-creation pipeline.

## Consequences

### Schema changes

- `FlowInstruction.ts`: `GitInstructionSchema` and `ShellInstructionSchema`
  added to `FlowInstructionUnion`.
- `FlowInstruction.test.ts`: tests added for both new schemas.
- Corresponding TypeScript types (`GitInstruction`, `ShellInstruction`)
  exported alongside existing types.

### Executor changes

- `GitStepExecutor.ts`: implements `add-and-commit` and `push-current` via
  `execFile`.
- `ShellStepExecutor.ts`: implements arbitrary shell command execution via
  `execFile`.
- Both executors registered in `StepExecutorRegistry` at init time.

### Flow definition changes

- `implement/flow.json`: `open_pr` routine uses `git` (add-and-commit,
  push-current) and `shell` (gh pr create) instructions.

### Validation

- `FlowLoader.ts`: `validateRoutineSteps` validates git/shell instructions
  structurally (TypeBox schema) and semantically (workspace refs in `cwd`).

## Trade-offs

- Adding two instruction types to the union increases the discriminator
  surface but enables the full PR pipeline without introducing a
  Turing-complete expression language or general scripting capability.
- `gh pr create` is not a dedicated instruction — it's expressed as a shell
  command. This keeps the vocabulary small but means the flow author must
  know the exact `gh` CLI invocation. A future ADR could add a `github`
  instruction type with structured parameters if this becomes a common
  authoring pattern.
- The `cwd` field is required rather than optional because both git and
  shell operations are meaningless without a working directory. This is
  stricter than the `agent` instruction's optional `workingDir` but
  appropriate for deterministic infrastructure steps.

## Status of related ADRs

- **ADR 0003** (loop gate and tool params): unaffected — `continueWhile`
  expressions and `toolParams` are independent of the instruction vocabulary.
- **ADR 0005** (named workspaces): git/shell instructions use the
  `workingDir: { workspace: id }` pattern to reference workspaces by name.
- **PLAN.md §4**: the git/shell instructions are listed as required for
  routines to produce PR-able state.

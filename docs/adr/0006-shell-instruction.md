# ADR 0006: The `shell` instruction type

**Date:** 2026-06-27
**Status:** Accepted

## Context

The routine-based flow architecture (see `PLAN.md` and
`UPDATED_FLOW_ARCHITECTURE.md`) runs each routine as a deterministic sequence
of steps. A routine that wants to produce a PR-able state must, at some point,
run git/`gh` commands (commit, push, `gh pr create`). None of the original
five instruction types (`workspace`, `agent`, `parallel`, `loop`, `cleanup`)
can run an arbitrary shell command, so the deterministic portion of a flow
could build code and review it but could never close the loop to a pull
request — that work would fall back to the LLM doing raw `bash`, defeating the
point of the deterministic skeleton.

`ShellStepExecutor` was introduced as a built-in step executor in commit
`82de19a` (M1+M2), but the `FlowInstruction` **schema union** was not extended
to include a `shell` member. As a result, a `shell` step inside any routine
would pass type-checking at the executor-dispatch layer but **fail
`FlowLoader` structural validation** at load time — the executor existed but
the loader rejected its instruction. Commit `1c9629f` (F2 finish) closes that
gap by adding `shell` to the validated union.

## Decision

Add a sixth instruction type, `shell`, to the `FlowInstruction` schema union:

```typescript
export const ShellInstructionSchema = defineInstruction("shell", {
  command: Type.String({ minLength: 1 }),
  cwd: Type.Optional(Type.String()),
});

export type ShellInstruction = Type.Static<typeof ShellInstructionSchema>;

// FlowInstruction = WorkspaceInstruction | AgentInstruction | ParallelInstruction
//                  | LoopInstruction | CleanupInstruction | ShellInstruction;
```

Shape: `{ type: "shell"; id: string; command: string; cwd?: string }`.

- `command` — the shell command string. Supports `{{...}}` placeholder
  resolution via `FlowContext.resolve()` before execution (so
  `{{workspace}}`, `{{title}}`, etc. are substituted from routine params /
  prior results).
- `cwd` — optional working directory, likewise resolved through
  `FlowContext.resolve()`. When `cwd` is omitted, the executor falls back to
  the routine context's `workspace` path (so a routine operating in its own
  worktree can omit `cwd`).

`ShellStepExecutor` runs the command via Node's `child_process.exec`,
captures stdout/stderr as the step's `InstructionResult.raw`, and on a
non-zero exit records the failure message in `raw` (`Command failed: …`).
A 30s per-command timeout guards against hung commands.

## Open execution is intentional

This is the instruction type that breaks the "no side effects beyond agent
worktrees and isolated workspaces" property of the original five. It is
deliberately limited:

- It is a **step type**, not a free-floating capability: it can only appear
  inside a routine's `steps`, chosen by the flow author, and is subject to
  the same `FlowLoader` semantic validation as the others.
- It does not introduce branching, parallelism, or LLM control; the
  orchestrator LLM decides _whether_ to call the routine tool that contains
  `shell` steps, but the deterministic execution of those steps is fixed.
- It carries no tool-preset / governance integration in the MVP; routine
  tools are registered by the extension at init (see `src/index.ts` wiring),
  so a flow package gates `shell` access by which routines it declares and
  which it lists in `orchestrator.activeTools`.

## Consequences

- `FlowInstruction.ts`: `ShellInstructionSchema` + `ShellInstruction` type
  added; joined to `FlowInstructionUnion`; re-exported from the orchestrator
  barrel. Commit `1c9629f`.
- `scripts/generate-flow-schema.ts`: emits a `shell` `$def`; regenerated
  `src/flows/flow-schema.json` now contains it.
- `src/flows/implement/flow.json`: a new `open_pr` routine composed of three
  `shell` steps (commit, push, `gh pr create`), with each step's `cwd` set
  to `"{{workspace}}"` and the PR title substituted via `{{title}}`.
- `FlowLoader` validates `shell` steps via the union (no bespoke semantic
  rules in the MVP — there is nothing TypeBox cannot already express).
- `FlowInstruction.test.ts`: schema-acceptance / rejection cases for the
  new member.

## Related

- ADR 0003 D.2 (typed `toolParams` → moved onto each `Routine` in F1) is
  adjacent: routine `params` now declare the values `shell` steps receive
  via placeholders (e.g. `open_pr` declares `{workspace}`, `{title}`).
- ADR 0005 (named workspaces, deferred) is the future where `cwd` could
  reference a workspace _by name_ rather than a resolved path; until then,
  `cwd` is a path string resolved through `FlowContext.resolve()`.

## Status of sibling ADRs

- ADRs 0001 (`Superseded`), 0002 (`Partially superseded` by 0005; C.1/C.2
  in force), 0003 (`Accepted`), 0004 (`Accepted`), 0005 (`Accepted`,
  deferred implementation): unchanged by this ADR.

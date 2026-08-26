# ADR 0008: Worktree base-ref contract, output-parsing validation, and `open_pr` commit hard-fail

**Date:** 2026-07-02
**Status:** Accepted

## Context

Three latent bugs in the workspace/git layer compounded to make the
`open_pr` routine publish **empty branches and misleading PRs** whenever anything
went slightly wrong:

1. **Wrong base ref.** `WorktrunkProvider.createWorkspace` invoked
   `wt switch -c <branch>` without a `--base` flag, so Worktrunk branched the
   builder's worktree off the repository's _configured default branch_
   (usually `main`), not off the branch the orchestrator was actually running
   on. When the orchestrator ran on a long-lived refactor branch
   (`refactor/agent-hierarchy`), the builder's worktree started from `main` and
   **lacked every file the discovery/define phases had produced** — including the
   tests, the source under change, and these very ADRs. The builder only
   "worked" by coincidence, on tasks scoped to files that pre-existed on `main`.

2. **Garbage path parsing.** `parseWtPath` only inspected the _last line_ of
   Worktrunk's output and used `@` as its delimiter, falling back to
   **the entire last line** whenever that delimiter was absent. Worktrunk
   frequently appends non-path lines after the worktree line (hooks, hints,
   progress), so the "last line" coincidental match silently returned whatever
   string happened to be last — a hook banner, a tip, anything. There was no
   filesystem validation, so an entirely bogus `path` would propagate to every
   downstream step (`agent` working dirs, `git` cwd, `destroyWorkspace`) and
   amplify the damage.

3. **Soft commit failure.** `GitStepExecutor.execute` wrapped
   `add-and-commit` failures as a soft `passed:false` `InstructionResult` exactly
   like `push-current`. `RoutineExecutor` does not inspect `passed` to gate
   later steps — it only aborts on a _thrown_ error — so a failed commit was
   swallowed, the routine marched on to `push-current`, and `git push origin
HEAD` happily published the **branch state before the commit** (the empty
   worktree Worktrunk had just created). `gh pr create` then opened a PR for an
   empty branch.

### Why all three hit at once

On `refactor/agent-hierarchy`, bug #1 meant the builder's worktree had no
target files. The agent therefore produced _no_ edits, so `git commit` exited
non-zero ("nothing to commit"). Bug #3 swallowed that. Bug #2 meant even the
path reported back was unreliable. The user-visible symptom was "open_pr opened
a PR with zero changes against `main` instead of against the refactor branch."

## Decision

### 1. Worktrunk worktrees branch from the current branch by default

`WorktrunkProvider` gains a `baseRef` constructor parameter, defaulting to
`"@"` — Worktrunk's literal for "the current branch / HEAD of the source
repository". `createWorkspace` now invokes:

```
wt switch -c <branch> --base <baseRef>
```

The default `"@"` makes the builder's worktree stem from **whatever branch the
orchestrator is checked out on**, which is the only sensible base for a
feature-forge run. Callers may override `baseRef` with an explicit ref
(`main`, `develop`, a SHA, …) when they genuinely want a different starting
point.

> **Contract:** `WorktrunkProvider` NEVER silently branches from the
> repository's configured default branch. The base is always either the current
> branch (default) or an explicitly-supplied ref. There is no third option.

### 2. `parseWtPath` scans _all_ lines, matches the `worktree @` marker, and validates on disk

`parseWtPath` is rewritten to:

1. Scan **every** line of `wt switch -c`'s output for the literal marker
   `worktree @ ` — not just the last line. The authoritative path is the one on
   the line containing that marker; coincidental last-line matches are gone.
2. If **no** line contains the marker, throw `WorkspaceError` with a message
   naming the missing marker. The old "fall back to the whole last line"
   behaviour is **removed** — it was the source of the garbage paths.
3. Expand a leading `~` to the user's home directory (unchanged).
4. **Validate** the resulting absolute path with `existsSync`. If Worktrunk
   reports a path that does not actually exist on disk, throw `WorkspaceError`
   naming the bogus path and the word "does not exist on disk".

> **Contract:** `WorktrunkProvider.createWorkspace` returns a path iff (a) the
> output contains a `worktree @ <path>` line _and_ (b) that path exists on the
> filesystem. Any other outcome is a thrown `WorkspaceError`, not a
> best-effort string.

### 3. `add-and-commit` is a hard failure; `push-current` stays soft

`GitStepExecutor.execute` now **re-throws** any error from `add-and-commit`
(after logging it) instead of wrapping it as a soft `passed:false` result.
`RoutineExecutor` only aborts a routine on a thrown error, so this stops the
`open_pr` routine the instant the commit fails — _before_ `push-current`
publishes an empty/stale branch and _before_ the `gh` step opens a misleading
PR.

`push-current` deliberately keeps its existing soft behaviour: a failed push is
often retryable / network-related, and surfacing it as `passed:false` (while
still letting the routine breathe) is preferable to nuking the whole routine
on a transient remote error.

This asymmetry is documented in the executor's JSDoc:

| Action           | Failure mode                 | Why                                    |
| ---------------- | ---------------------------- | -------------------------------------- |
| `add-and-commit` | throws (hard)                | precondition for `push-current` + `gh` |
| `push-current`   | `passed:false` result (soft) | often retryable / network-related      |

## Consequences

- Worktrees always contain the orchestrator's branch state, so builders see
  the tests, source, and ADRs the discovery/define phases produced.
- A bogus or nonexistent worktree path is now a loud, immediate failure rather
  than silent corruption that propagates to every downstream step.
- A failed commit aborts `open_pr` cleanly; empty branches and misleading PRs
  are no longer possible from this code path.
- Callers of `WorktrunkProvider` that relied on the old garbage-fallback
  behaviour (there are none in-repo) must now handle the thrown
  `WorkspaceError`.

## Scope

Touches only: `WorktrunkProvider`, `WorktrunkProvider.test.ts`,
`GitStepExecutor`, `GitStepExecutor.test.ts`. `GitWorktreeProvider`,
`RoutineExecutor`, `WorkspaceStepExecutor`, `FlowContext`, the `flow.json`
structure, and `AgentSpecification` are intentionally out of scope.

## Amendment (2026-08-26): `GitWorktreeProvider` defaults to `origin/HEAD` with a best-effort remote refresh

The original ADR fixed `WorktrunkProvider`'s default base to `"@"` (the current
branch). The git-worktree backend (`GitWorktreeProvider`, the provider used by
the flow routines) had its own default of `"HEAD"`, which suffers the same
class of bug: a worktree created from the _local_ `HEAD` may miss commits that
exist only on the remote (stale local clone), and a detached or bare local
`HEAD` can point anywhere.

### Decision

1. `GitWorktreeProvider`'s constructor default changes from `"HEAD"` to
   `"origin/HEAD"`, so new worktrees branch from the remote's tip by default.
   Callers may still pass an explicit `baseRef` (`"HEAD"`, `main`, a SHA, …)
   to override.
2. Before creating a _new_ worktree (generated branch, or explicit branch that
   does not exist yet) from the default `origin/HEAD` base, the provider
   best-effort runs `git fetch origin` via a new private helper
   `refreshRemoteRefs()`, then verifies the base resolves
   (`git rev-parse --verify origin/HEAD^{commit}`). Only when `origin/HEAD`
   cannot be resolved - not on a failed fetch alone - does the base fall back
   to the local `HEAD`; creation never blocks. (A failed fetch with a
   still-resolvable `origin/HEAD` proceeds with the possibly-stale ref -
   deliberate, documented trade-off.) This matters because `origin/HEAD` does
   not exist in repos without an `origin` remote, in repos whose origin was
   added via `git remote add` after `git init` on git < 2.48 (git 2.48+
   creates it on fetch for non-empty remotes), and in clones taken from an
   empty remote even _after_ a successful fetch (there is no branch to point
   at - on git < 2.48 only a clone of a non-empty remote or `git remote set-head`
   creates it, while on git 2.48+ a successful fetch of a non-empty remote
   does too; an empty remote never has a branch, so it stays absent
   regardless of git version).
3. Explicitly provided base refs (via the constructor or `createWorkspace`
   options) are used as-is: no fetch, no fallback. An unresolvable explicit
   ref fails loudly.
4. Reusing an existing branch (e.g. adding to an open PR) performs no
   `origin/HEAD` refresh: the branch is checked out directly. (`branchExists`
   may fetch a remote-only branch by name first - a targeted branch fetch, not
   a full remote refresh.)

> **Contract:** new worktrees branch from the remote's `origin/HEAD` when no
> explicit `baseRef` is given; when `origin/HEAD` cannot be resolved - not on
> a failed fetch alone - the base falls back to the local `HEAD` and never
> blocks creation; explicitly provided base refs are used as-is (no fetch, no
> fallback); branch reuse performs no `origin/HEAD` refresh. Note that an
> explicitly provided
> `origin/HEAD` is
> equivalent to the default: the code distinguishes by value
> (`effectiveBaseRef === DEFAULT_BASE_REF`), not by source, so it is refreshed
> and falls back too.

### Relationship to the original ADR's current-branch rationale

This amendment is in deliberate tension with the original ADR, and the tension
is intentional. The original bug #1 was that builder worktrees branched from
the repository's _configured default branch_ and thus **lacked the
orchestrator's local, unpushed work**; the fix was to branch from the current
branch. `origin/HEAD` _is_ the remote's default branch, so it carries the
inverse risk: a worktree created from it may lack local-only commits (un-pushed
ADR/PLAN commits on a feature branch).

The git backend accepts this trade-off because its worktrees are created by the
flow routines from a _clean remote baseline_: the orchestrator's session
branches are pushed before a builder worktree is requested, and `Worktrunk`
(the local-work-sensitive backend) still defaults to the current branch via
`"@"`. Callers who need current-branch semantics for a git-backed worktree
pass `baseRef: "HEAD"` (or a concrete branch), which restores exactly the
original ADR's behavior, and the local-`HEAD` fallback in point 2 keeps
local-only repos fully working.

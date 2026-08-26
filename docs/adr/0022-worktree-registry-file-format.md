# ADR 0022: Worktree registry file format

**Date:** 2026-08-26
**Status:** Accepted (implemented by the worktree registry hardening)

## Context

`.forge/worktrees.json` is the file-backed `WorktreeRegistry`
(`core/src/workspace/WorktreeRegistry.ts`): a JSON array of `{path, createdAt,
branch?}` handles tracking active worktrees across sessions. Investigation
found the format and its handling were half-wired and unsafe:

- **Startup reconciliation was dead** - `reconcileAndLog()` was reachable only
  from tests; the startup call in the CLI composition root was dropped in a
  merge, so crash leftovers were never surfaced (restored as part of this
  hardening).
- **No schema or version on the persisted format** - `fromJSON` was permissive;
  a malformed file threw out of `load()` uncaught in the CLI composition root,
  so the extension failed to load entirely.
- **Concurrent sessions clobbered each other** - `persist()` dumped the
  in-memory map without re-reading the file; two pi sessions on one repo lost
  entries via last-writer-wins.
- **`branch` was optional** - every handle in practice had a branch (the
  `git-worktree` provider always creates `forge/<id>`), but the format allowed
  its absence and `reconcile()` had to filter on it.
- **No attribution data** - nothing recorded which session/flow created a
  worktree, so the crash-resume promise ("resume or destroy") had no data
  behind it.
- **Tests polluted the real file** - four test files constructed
  `new WorktreeRegistry()` with the default storage path, persisting test
  fixtures into the real repo file.

This ADR defines the versioned on-disk format and the policies around it.

## Decision

- **D1 - Versioned envelope, `branch` required.** The persisted format is
  `{version: 1, worktrees: [...]}` where each entry is
  `{path, createdAt, branch, sessionId?}`. `path` is the absolute workspace
  directory (unique), `createdAt` a serialized ISO-8601 string (as produced by
  `Date.toISOString()`), `branch` the `forge/<id>` branch name (required - the
  `WorkspaceHandle` constructor now takes it as a mandatory field), and
  `sessionId` an optional pi session id (D6). `version` pins the on-disk
  contract: a future format bump must either extend the schema or introduce a
  new literal version.
- **D2 - `WorktreeRegistryCodec` owns all validation.** Encoding, decoding,
  and validation live in a static-only utility class
  (`core/src/workspace/WorktreeRegistryCodec.ts`, ADR 0017), so the registry
  only deals with file I/O and in-memory state. Validation uses a TypeBox
  schema checked at runtime with `Value.Check` / `Value.Errors`, mirroring the
  `FlowValidation` error format (per-field `instancePath: message` lines).
  `createdAt` is kept a plain string in the schema - parseability is validated
  by `Date.parse` in the codec rather than encoded as a regex, avoiding
  over-strict pattern drift. Runtime validation in core uses **typebox** (a
  peer dependency); **ajv** stays a devDependency (used only to compile the
  exported JSON schema for external files) and must not appear in runtime
  paths.
- **D3 - v0 legacy migration.** A bare JSON array (the pre-versioning format)
  is detected on load, wrapped into the v1 envelope, and entries that fail
  per-entry validation are dropped with a warning per entry. The file is
  gitignored runtime state, but users may have real entries from before this
  change, so they migrate on first load instead of being discarded wholesale.
- **D4 - Corrupt files warn, never brick.** A missing, unreadable,
  unparseable, or schema/version-mismatched file logs a warning and yields an
  empty registry; the next successful `persist()` self-heals the file. This is
  a deliberate deviation from the load-time fail-loud precedent: ephemeral
  runtime state must never prevent the extension from loading.
- **D5 - Concurrency: in-process mutex + merge-on-write + atomic rename.**
  `register()` / `remove()` serialize their read-modify-write persist cycles
  through an in-process promise-queue mutex, so concurrent routine calls cannot
  interleave. Each write re-reads the current file, computes the union with
  in-memory items (in-memory wins per path; paths removed this process are
  tombstoned so stale disk state cannot resurrect them), writes to
  `<storagePath>.tmp-<pid>`, and renames over the target (atomic on POSIX), so
  readers never see a torn file. The residual cross-process lost-update race
  is accepted and documented: a stale dir is flagged by `reconcile()` and
  self-heals via the prune path. A lockfile is explicitly out of scope.
- **D6 - Session attribution via provider.** `sessionId` is stamped by the
  registry, not by callers: `setSessionIdProvider(provider)` is wired in the
  CLI composition root to `ctx.sessionManager.getSessionId()` (a UUIDv7),
  refreshed on `session_start` and `before_agent_start` (which fire on
  `/new` / `/resume`). The stamp is applied only when a handle carries no
  `sessionId`. The field is optional because the id is only observable inside
  a live pi session - it can legitimately be `undefined` before the first
  session hook fires, and no placeholder value is written.
- **D7 - Tests never touch the default storage path.** Tests exercise the
  registry through the in-memory `MockWorktreeRegistry` (already present in
  core and CLI test utils) instead of constructing `new WorktreeRegistry()`
  with the default path, ending the test pollution of the real
  `.forge/worktrees.json`.

## Consequences

- The on-disk format changes from a bare array to a versioned envelope
  (`{version: 1, worktrees: [...]}`); the file is gitignored runtime state, so
  no migration chore is required beyond the automatic v0-to-v1 wrap on first
  load.
- Existing v0 files with real entries migrate transparently; invalid entries
  are dropped with warnings, so no user data is silently lost.
- The registry file can no longer crash extension startup; corrupt files
  self-heal on the next write.
- Multi-session usage no longer loses entries on writes, and each entry
  carries the pi session id that created it - the data behind the crash-resume
  promise.
- Future format changes must extend the v1 schema or introduce a new version
  literal with its own migration path in `WorktreeRegistryCodec`.
- New API surface: `WorktreeRegistry.setSessionIdProvider`;
  `WorktreeRegistryCodec.parse`/`serialize` (new static utility class, internal
  to the workspace module - not re-exported from the package root);
  `WorkspaceHandle` with required `branch` and optional `sessionId`.

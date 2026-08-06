# NOTES — log-retention-cleanup (#203)

## Current task

- Subtask 5 iteration 2: apply review feedback to `.events.jsonl` rotation (fall-through on rename failure, counter reset inside try, prepopulate line-count seeding) — code + committed unit tests done, full validation pending

## Task list / AC checklist

- [ ] AC1: Add a configurable retention policy (e.g. `logRetentionDays`, default ~7) applied lazily on startup/`FileLogger` init: prune `forge-*.log`, `agent-streams-*`, and per-run logs older than the window.
- [ ] AC2: Cap or rotate oversized stream files (`.events.jsonl`) instead of append-forever.
- [ ] AC3: Add a `cleanup()` / exit hook for `SharedStreamDir` so directories are removed when the owning process ends, and sweep empty dirs on startup.
- [ ] AC4: Stop double-writing full LLM payloads at debug level (or gate payload logging behind a dedicated config flag, keeping debug entries structural only).
- [ ] AC5: Ship tests covering retention, rotation, and exit cleanup.

## Subtask plan

- [x] 1. Config schema — add `logRetentionDays` and `logPayloads` to schema, defaults, and typed accessors (verify passed: check routine reports 0 critical findings; coverage gate failure is pre-existing on main, CI doesn't enforce it)
- [x] 2. FileLogger retention — prune old logs on init
- [x] 3. SharedStreamDir cleanup — static cleanup(), sweep on get(), remove old dirs (verify passed: review found 2 P2, all non-blocking; e2e 70/70 green)
- [x] 4. Gate payload logging — only include full event data in debug logs when `logPayloads` is true (verify feedback resolved: config read moved into the progress handler + spy-based payload-gating tests shipped; CLI tsc gate clean; full suite green)
- [x] 5. Cap stream files — line-count-based rotation for `.events.jsonl` in AgentViewerState (build passed: tsc gate clean, full suite 106 files/2009 tests green, 50k-push rotation smoke test verified archive=50k lines + fresh file=1 line; iteration 2: review feedback applied — rename failure now falls through to `.messages.jsonl` persistence instead of early-returning, counter reset moved inside try after `renameSync` succeeds, `prepopulateStreamFiles` seeds `eventsFileLineCounts` from the actual line count of an existing `.events.jsonl`; committed unit tests shipped for rotate-at-cap, archive-created, fresh-file-start, stale-archive-overwrite, rename-failure fall-through)
- [ ] 6. Tests — FileLogger retention, SharedStreamDir cleanup, config schema, AgentViewerState rotation (RoutineTool payload-gating spy test shipped early in subtask 4 per review feedback; rotation unit tests shipped in subtask 5 iteration 2 per review feedback; dispose-cleanup + e2e rotation remain here)

## AC5 test case enumeration (subtask 6 deferral contract)

Shipped as committed unit tests in subtask 5 (iteration 2):

- rotate-at-cap — pre-session `.events.jsonl` seeded at the cap; one push crosses it and triggers rotation
- archive-created — `.events.1.jsonl` exists with cap + 1 lines (includes the triggering event, which is appended before rotating)
- fresh-file-start — next append recreates `.events.jsonl` with 1 line
- stale-archive-overwrite — POSIX rename replaces a pre-existing archive
- rename-failure fall-through — `message_end` still persisted to `.messages.jsonl` when the archive rename fails

Deferred to subtask 6:

- dispose-cleanup — `eventsFileLineCounts` cleared (extend the existing dispose test)
- e2e rotation through CLI — force rotation with a small cap via config, asserting the AC2 path end-to-end

## Decisions made this session

- Config fields placed after `logDir` in schema/defaults (logging-grouped); accessors after `getJsonRetryMaxAttempts()` per plan (why: keep logging config contiguous, accessor placement per plan spec)
- `logRetentionDays` uses `Type.Integer({ minimum: 0 })` — 0 means "never prune" (keep all logs); only negatives rejected at validation (why: 0 is a legitimate retention policy; avoids a separate disable-retention code path in subtask 2)
- `logPayloads` schema carries an explicit `{ default: false }` so TypeBox `Value.Default()` and `resolveConfig()` behave consistently, matching the existing schema default pattern (why: verify feedback flagged the missing annotation)
- Tests for the new fields shipped in subtask 1 (schema validation, accessor fallbacks, defaults-JSON mirror assertions) per verify feedback — not deferred to subtask 6
- Wired `logRetentionDays`/`logPayloads` through `ConfigLoader.toResolvedConfig()` — the loader was silently dropping them (why: config-file values must reach `resolveConfig()`, caught by the new accessor tests)
- `pruneOldLogs(retentionDays, currentFilePath?)` takes an optional current-file path instead of tracking it statically (why: plan's skip-current-file rule needs the active logger's path; explicit param avoids hidden mutable state)
- Prune summary `logger.info` only fires when `deleted > 0` (why: unconditional logging on every `initialize()` would create the log file during construction, breaking the lazy-creation contract in tests when the configured logDir exists — the worktree `.forge/logs` symlinks to the live main log dir)
- Shared-package coverage dropped lines 89.12→87.74 vs origin/main but the 90% gate already fails on main (why: new `pruneOldLogs` intentionally untested — tests deferred to subtask 6; CI doesn't enforce coverage)
- RoutineTool debug progress entry now logs only `{ phase, message }` when `logPayloads` is false (default), full `{ ...event }` only when true (why: prevents MB-scale debug entries from agent-stream payloads — the 53GB log-growth root cause)
- RoutineTool reads `logPayloads` lazily on the first progress event inside the handler, not at the top of `execute()` (why: review feedback — config access should only happen when a debug entry is actually written, avoiding unconditional config reads for non-logging invocations)
- `AgentViewerState` now rotates `.events.jsonl` at 50k lines: renames to `.events.1.jsonl` (POSIX rename overwrites a stale archive) and starts fresh; counters live in a per-agent `eventsFileLineCounts` map, reset on rotation and cleared in `dispose()` (why: keeps current-file count session-local, matching the other per-agent maps)
- Rotation is best-effort: `renameSync` failure logs a warning and keeps appending to the current file (why: never lose event persistence; a too-big file is acceptable over data loss)
- `prepopulateStreamFiles` ignores `.events.1.jsonl` archives — only the current file is line-counted (why: archives are read-only; retention pruning in subtasks 2/3 cleans them)
- Rotation rename failure no longer early-returns: it falls through to the `.messages.jsonl` persistence logic, and the counter stays at the cap for a harmless retry on the next event (why: review feedback — a failed rename must not drop a finalized `message_end` from persistent storage)
- `eventsFileLineCounts.set(agentId, 0)` moved inside the `try` block immediately after `renameSync` succeeds (why: review feedback — the counter reset is a consequence of successful rotation, not coupled to the absence of an early return)
- `prepopulateStreamFiles` seeds `eventsFileLineCounts` via a streaming line count of the existing `.events.jsonl` (why: review feedback — a pre-session file already over the cap must rotate on the next event, not after another 50k appends)
- `MAX_EVENTS_FILE_LINES` exported from `AgentViewerState` (why: committed tests assert against the real cap instead of duplicating 50_000)

## Next action on resume

- Finish subtask 5 iteration 2: run the full validation loop (`npm run fix`, `npm run lint`, `npm run typecheck`, `npm test` from repo root), commit the review-feedback fixes + rotation unit tests, then start subtask 6 with the AC5 enumeration above (dispose-cleanup unit test, e2e rotation via small-cap config, FileLogger retention, SharedStreamDir cleanup)

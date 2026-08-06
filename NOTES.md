# NOTES — log-retention-cleanup (#203)

## Current task
- Subtask 2: FileLogger retention — prune old logs on init

## Task list / AC checklist
- [ ] AC1: Add a configurable retention policy (e.g. `logRetentionDays`, default ~7) applied lazily on startup/`FileLogger` init: prune `forge-*.log`, `agent-streams-*`, and per-run logs older than the window.
- [ ] AC2: Cap or rotate oversized stream files (`.events.jsonl`) instead of append-forever.
- [ ] AC3: Add a `cleanup()` / exit hook for `SharedStreamDir` so directories are removed when the owning process ends, and sweep empty dirs on startup.
- [ ] AC4: Stop double-writing full LLM payloads at debug level (or gate payload logging behind a dedicated config flag, keeping debug entries structural only).
- [ ] AC5: Ship tests covering retention, rotation, and exit cleanup.

## Subtask plan
- [x] 1. Config schema — add `logRetentionDays` and `logPayloads` to schema, defaults, and typed accessors
- [ ] 2. FileLogger retention — prune old logs on init
- [ ] 3. SharedStreamDir cleanup — static cleanup(), sweep on get(), remove old dirs
- [ ] 4. Gate payload logging — only include full event data in debug logs when `logPayloads` is true
- [ ] 5. Cap stream files — line-count-based rotation for `.events.jsonl` in AgentViewerState
- [ ] 6. Tests — FileLogger retention, SharedStreamDir cleanup, config schema, AgentViewerState rotation

## Decisions made this session
- Config fields placed after `logDir` in schema/defaults (logging-grouped); accessors after `getJsonRetryMaxAttempts()` per plan (why: keep logging config contiguous, accessor placement per plan spec)
- `logRetentionDays` uses `Type.Integer({ minimum: 0 })` — 0 means "never prune" (keep all logs); only negatives rejected at validation (why: 0 is a legitimate retention policy; avoids a separate disable-retention code path in subtask 2)
- `logPayloads` schema carries an explicit `{ default: false }` so TypeBox `Value.Default()` and `resolveConfig()` behave consistently, matching the existing schema default pattern (why: verify feedback flagged the missing annotation)
- Tests for the new fields shipped in subtask 1 (schema validation, accessor fallbacks, defaults-JSON mirror assertions) per verify feedback — not deferred to subtask 6

## Next action on resume
- Proceed to subtask 2 (FileLogger retention): read `packages/shared/src/logging/FileLogger.ts`, prune `forge-*.log` files older than `logRetentionDays` on init

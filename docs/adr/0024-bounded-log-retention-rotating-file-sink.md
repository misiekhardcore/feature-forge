# ADR 0024: Bounded log retention (rotating file sink)

**Date:** 2026-09-02
**Status:** Accepted (implemented by the bounded-retention rotating file sink)

## Context

An ENOSPC incident surfaced the unbounded-disk class of problems in the
logging surface. `FileLogger` wrote a single session log file per process
that grew without any size cap - a 280 MB single file was observed - and
retention was age-only: `pruneOldLogs` deleted files older than
`logRetentionDays` (default 7), but a process that wrote heavily could fill
the disk long before the age cutoff, and nothing bounded a single file's
growth at all. The age-based prune ran only at logger initialization, so
long-running sessions were entirely unguarded between restarts.

The agent-streams surfaces had the same unbounded shape. Phase B of the
viewer roadmap replaced the legacy `.stream` / `.events.jsonl` /
`.messages.jsonl` files with a single per-agent journal
(`{agentId}.journal.jsonl`, ADR 0023), and the legacy `.events.jsonl`
50k-line rotation to `.events.1.jsonl` was removed - so an agent run's
journal was a single append-only file with no size cap until the
whole-directory 7-day prune covered it.

The user directive: adopt the full mechanism set of oh-my-pi's logger
(`packages/utils/src/logger`: `rotating-file.ts` + `pruneStaleProcessLogs`)
instead of inventing a parallel scheme, so session logs, stale-process
namespaces, and journals all fall under one bounded-retention policy.

## Decision

- **D1 - `RotatingFileSink` (core/logging).** A synchronous append sink
  with two rotation axes and bounded retention:
  - **Size rotation** (`maxBytes`, default 10 MB): when the active file
    exceeds `maxBytes`, the next append starts a new numeric segment
    (`.1`, `.2`, ...). Rotation is evaluated before the append (OMP
    pre-append roll semantics): a record that would push the active file
    past the cap opens the next segment instead.
  - **Daily rotation** (`dayRotation`, default true): the local calendar
    day is embedded in the filename and a day change resets the segment
    index to zero.
  - **Count retention** (`maxFiles`, default 5): two modes. **Audit-ledger
    mode** (production logger): a persistent FIFO ledger
    (`.prefix-<pid>-audit.json`, OMP-compatible shape) tracks every file
    ever written and bounds the TOTAL file count including the base file,
    deleting the oldest tracked files first - the only retention that
    understands day-rotated names, so `dayRotation: true` requires it.
    **Readdir-segment mode** (journal surfaces): with `dayRotation: false`
    and no ledger, retention enumerates the numeric segments
    `prefix.suffix.ext.N` in the directory and removes the lowest indices
    until at most `maxFiles` numeric segments remain; the base segment is
    never removed. Audit-ledger removal is directory-containment guarded:
    a ledger entry pointing outside the sink's own directory is dropped
    without touching the target, so a tampered or relocated ledger can
    never make retention delete what it does not own. `write` never
    throws - failures are reported through the boolean return value.
- **D2 - `FileLogger` on the sink.** Production naming is
  `forge.<day>.<pid>.log[.N]` (prefix from `ForgeConfig.getLogPrefix`,
  pid suffix), matching OMP so tooling written against OMP log names keeps
  working. An explicit-path mode (tests, custom paths) writes to exactly
  the given base filename with no day rotation and no audit ledger. The
  config knobs `logMaxBytes` / `logMaxFiles` (defaults 10 MB / 5) drive
  both modes; the audit ledger path derives from the configured prefix
  (`.<prefix>-<pid>-audit.json`) so agent subprocesses that log under
  their own agent-id prefix self-prune like the orchestrator.
- **D3 - Retention stack.** The age-based `pruneOldLogs` stays as the
  first bound but is segment-aware: rotated `.log.N` segments are matched,
  and the whole segment set of the current process is protected from
  age-pruning (the active segment is dynamic under rotation).
  `pruneStaleProcessLogs` ports OMP: at logger initialization, dead-pid
  namespaces are reaped - audits are removed outright, rotated logs are
  kept only within a 5-day window (today included), capped at
  `RETAINED_STALE_LOGS_PER_PROCESS_DAY` (3) newest segments per
  process/day. Live PIDs are never touched (kill-0 probe, EPERM treated
  as alive).
- **D4 - Journal segments.** `AgentJournal` writes
  `{agentId}.journal.jsonl[.N]` through the sink in journal mode
  (`dayRotation: false`, no audit ledger): segment 0 = the base file
  (oldest), the highest index is the active segment, and `read()` replays
  0 → N so append-order chronology is preserved. `maxFiles` bounds the
  numeric segments only - the base is never removed, and when the segment
  count exceeds the cap the lowest indices are evicted, so beyond
  `maxFiles` segments of history the oldest entries are dropped (the same
  bounded-history tradeoff as OMP's count retention). The existing
  whole-directory 7-day `agent-streams-*` prune is retained as the second
  bound covering the base files of abandoned runs. Discovery treats only
  regular files as segments: a directory whose name matches `{base}.N`
  (e.g. a workspace collision) is skipped, never read as a segment.
- **D5 - Invariants.** (a) Writes are best-effort and never throw -
  journaling and logging must never interrupt an agent run. (b) Rotation
  follows OMP pre-append roll semantics. (c) Journal-mode selection never
  reuses a segment index across day boundaries or restarts: the first
  selection resumes at the highest existing segment, and later day changes
  never move the active segment - a reset would reuse low indices that
  already hold records (or were evicted), breaking the chronological 0→N
  order truthful replay depends on.

## Consequences

- Hard-bounded disk usage: session logs are bounded to
  `maxFiles × maxBytes` per process (audit mode counts the base file);
  journals are bounded to `maxFiles × maxBytes` per agent plus the base
  segment. A single file can never grow unbounded again - the 280 MB
  single-file failure mode is structurally impossible.
- Oldest-data eviction tradeoff: bounded retention deletes the oldest
  records first (journal segments, stale-process namespaces). History
  beyond the window is gone; the whole-directory 7-day prune remains the
  recovery bound for abandoned runs, not the primary one.
- Naming change: production logs move from the legacy `forge-*.log` shape
  to `forge.<day>.<pid>.log[.N]`. The age-based `pruneOldLogs` still
  matches and reaps legacy `forge-*.log` files, so old deployments are
  cleaned up by the existing path rather than accumulating forever.
- Config surface: `logMaxBytes` / `logMaxFiles` (defaults 10 MB / 5) join
  `logRetentionDays` as documented retention knobs (README configuration
  section), shared by the file logger and the agent journals so both
  persistence surfaces fall under one policy.
- New API surface: `RotatingFileSink`
  (`core/src/logging/RotatingFileSink.ts`, exported from
  `logging/index.ts`), the `FileLogger` production/explicit sink modes, and
  the sink-mode plumbing in `AgentJournal`. The sink is the single
  rotation/retention implementation - no parallel rotation logic remains.

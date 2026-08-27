# ADR 0023: Agent journal format

**Date:** 2026-08-26
**Status:** Accepted (implemented by the viewer journal unification)

## Context

The agent viewer persisted per-agent run data across three separate file
formats in `agent-streams-*` directories (`SharedStreamDir`,
`core/src/progress/sharedStreamDir.ts`):

- `{agentId}.stream` - human-readable formatted event lines, append-only.
- `{agentId}.events.jsonl` - raw `JsonAgentSessionEvent` objects with a
  50k-line rotation to `{agentId}.events.1.jsonl`.
- `{agentId}.messages.jsonl` - finalized `AgentMessage` objects.

Three formats meant three read paths, three rotation/reseed code paths, and
no single record of an agent run's lifecycle. Startup replay additionally
invented terminal state: `ensureStaleEntry` created a `done` entry for any
agent with files but no live entry, guessing `createdAt` from the stream
file's birthtime, `finishedAt` from its mtime, and the status outright.
Nothing recorded when a run started, finished, passed, or failed - status
was always inferred from file presence, and the timestamps were
filesystem-derived approximations.

Phase B of the viewer roadmap prescribed a single append-only journal per
agent that unifies messages, raw-event-derived records, formatted stream
lines, and lifecycle markers, with startup replay that reports history
truthfully instead of guessing it.

## Decision

- **D1 - One typed per-agent JSONL union.** Each agent run persists to a
  single `{agentId}.journal.jsonl` under the shared stream directory,
  replacing `.stream`, `.events.jsonl` (+ rotation), and `.messages.jsonl`
  (the D1 full unification). The file is append-only JSONL; writes are
  synchronous, best-effort, and never throw, so journaling never interrupts
  an agent run. Reads are line-by-line and tolerant: empty lines are
  skipped and structurally invalid or unparseable lines are warned and
  skipped so replay proceeds past partial writes. `AgentJournal`
  (`cli/src/tui/state/AgentJournal.ts`) owns the file contract and
  migration; `AgentViewerState` owns replay and live fan-out.
- **D2 - Entry union.** Every line is one of:
  - `lifecycle {phase: started|done|error|cancelled, passed?, summary?, ts}`
    - run lifecycle markers.
  - `message {message: AgentMessage, ts}` - finalized messages only
    (`user`, `assistant`, `toolResult` roles), derived from `message_end`
    events.
  - `tool {toolCallId, toolName, args?, result?, isError?, ts}` - derived
    from `tool_execution_start` / `tool_execution_end` events.
  - `stream {line, ts}` - the formatted human-readable line, gated by the
    same noise filter the legacy `.stream` persistence used
    (`message_update`, `turn_start`, `turn_end`, and empty `message_end`
    lines excluded).
  - `forge {phase: loop-round|workspace-ready|session-set, details, ts}` -
    reserved for future orchestrator context; no writer emits it yet, but
    replay tolerates it (structural guard accepts it, replay ignores it).
    The `error` and `cancelled` lifecycle phases are likewise tolerated at
    replay though only `started` and `done` are emitted today - no bus
    channels for error/cancelled exist yet, so the writer path can never
    produce them.
- **D3 - Lifecycle writes only from live wire events.** The overlay's
  `deliverStatusEvent` funnel is the single write path for lifecycle
  entries: `feature-forge:agent-started` / `feature-forge:agent-done`
  events deliver immediately, and pre-connect buffered status events
  deliver on `connect()`. AgentQuery seeding (the `getAllAgents()` loop in
  `connect`) and `prepopulateStreamFiles` replay never write lifecycle
  entries - seeding reflects the current session's live agents and replay
  is read-only. AC 8: no lifecycle is journaled unless a real wire event
  carried it.
- **D4 - Replay-first reopen.** `prepopulateStreamFiles` replays each
  journal into viewer state:
  - **Status** comes from the LAST lifecycle entry (last-lifecycle-wins):
    a trailing `started` means a newer run is in flight and the entry is
    replayed as `running` with no `finishedAt` - a stale terminal from an
    earlier run is never applied (started -> done -> started replays as
    running). A trailing `done` / `error` supplies status, `passed`,
    `summary`, and `finishedAt`; a trailing `cancelled` replays status and
    `summary` only - `AgentViewerState.update()` treats `cancelled` as
    non-terminal for stamping and clears `finishedAt` (loop re-runs must
    never inherit a stale stamp), so the replayed entry carries no stamp.
    Replay never invents a terminal state - `ensureStaleEntry` is deleted,
    and a journal with entries but no lifecycle replays as `running`.
  - **createdAt** derives in order: first `started` ts -> earliest valid
    entry ts (migrated journals carry no lifecycle) -> journal file
    birthtime (epoch-0 birthtimes treated as absent) -> now.
  - **finishedAt** is the terminal lifecycle ts, NaN-guarded: invalid
    stamps fall back to absent rather than producing "Invalid Date".
  - An agent with an empty journal gets no entry at all.
- **D5 - No-overwrite guard.** Replay never relabels an entry already
  present: an agent with a live-seeded entry (connect's agentQuery seeding
  or the pre-connect buffer) is the current session's truth and must not be
  overwritten with a journal terminal from a prior run of the same agent
  id. The derived caches (messages, tools, last stream line) are still
  populated, so a live entry keeps its historical data. This restores the
  pre-journal `ensureStaleEntry` contract without the status guessing.
- **D6 - One-shot legacy migration.** On first reopen, agents with only
  legacy files (`.stream`, `.messages.jsonl`, `.events*.jsonl` including
  rotated archives) are folded into a journal via
  `AgentJournal.migrateLegacy`, then replayed:
  - Derivation order is messages -> events -> stream; events sources are
    ordered by file mtime (oldest first, stable for ties) regardless of
    caller order, using each source file's mtime as the entry `ts`.
  - Unlink is EOF-gated: a file whose read did not reach EOF is skipped
    and left in place, never destroyed after a partial copy.
  - Delivery is at-least-once: entries append before legacy files are
    removed, so a crash between the two leaves the files in place and a
    retry re-appends (duplicates possible - deliberate, losing data is
    worse than duplicating it). An append failure skips the unlink phase
    entirely so a retry can re-migrate.
  - Idempotent: a second call finds no legacy files and is a no-op.
  - Divergence from the live writer: the live writer merges `args` captured
    at `tool_execution_start` into the paired end entry via an in-memory
    map; migration derives end entries without `args` because start/end
    pairing crosses independent file lines. Replay consumers pair the two
    `tool` entries per `toolCallId` themselves (the start entry carries
    args, the end entry result and `isError`), and the journal contract
    makes both forms structurally identical.
  - A journal's presence wins over leftover legacy siblings
    (partial-migration state): journaled agents are replayed directly and
    their remaining legacy files are ignored.
- **D7 - Retention unchanged.** Journals live inside the existing
  `agent-streams-*` directories, so `SharedStreamDir` prune (whole-directory
  removal against `logRetentionDays`) covers them with no change.
- **D8 - Operational constraint on migration.** `migrateLegacy` must only
  run when no agent is actively appending to that stream directory's legacy
  files - the EOF guard cannot protect a concurrently growing file. The
  caller migrates at startup (`prepopulateStreamFiles`) before any new
  writer starts, which satisfies the constraint for the shipped wiring.

## Consequences

- **Known limitations** (deliberate, from review):
  1. `tool_execution_update` streaming partials are not journaled - a
     fidelity regression versus the legacy raw `.events.jsonl` history,
     deliberate because the journal stores derived records, not raw events.
  2. Raw event history is gone: `loadConversationEvents` serves only the
     in-memory sliding window (`MAX_AGENT_EVENTS` = 200), with no disk
     history beyond it.
  3. The `done` phase coupling derives from the agentQuery status at emit
     time rather than the event payload alone - sound per
     `PiSubprocessAgent`'s emission order (terminal status precedes the
     event), latent as an ordering risk for future agent kinds.
- The viewer reads one file per agent instead of three; rotation,
  line-count reseeding, and per-format load paths are deleted.
- Startup replay is truthful: status, timestamps, and pass/fail come from
  journal entries written by real wire events, never guessed from file
  presence.
- Legacy deployments migrate transparently on first reopen; failed or
  partial migrations are safe to retry.
- New API surface: `AgentJournal` (append/read/migrateLegacy -
  `cli/src/tui/state/AgentJournal.ts`, package-internal), the
  `AgentJournalEntry` union, `AgentViewerState.appendLifecycle` /
  `getAgentTools`, and `AgentViewerOverlay.recordLifecycle`. The in-memory
  `toolStartArgs` map bounds to one slot per in-flight tool call.

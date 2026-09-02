# ADR 0025: Agent journal recorder at the routine layer

**Date:** 2026-09-02
**Status:** Accepted (implemented by the routine-layer recorder wiring)

## Context

ADR 0023 moved per-agent persistence into a single append-only journal
(`{agentId}.journal.jsonl`) with truthful replay, but the _live writer_ was
still the TUI viewer: `AgentViewerOverlay.wireOverlayEvents` subscribed to
the `feature-forge:agent-*` channels and the overlay's own
`AgentViewerState` (streamDir configured) appended journal entries. The
viewer only exists inside interactive pi sessions (`ctx.hasUI`), opens
lazily on the first agent progress event, and its subscriptions live as
long as the overlay is open. Journal completeness therefore depended on the
display lifetime, and live-routine runs reproduced four incompleteness
classes:

1. **Pre-connect started loss.** The overlay subscribes on open, so an
   agent that spawned before the overlay opened journaled nothing until
   `connect()` drained the buffer - and a routine whose first agent
   finished before the first progress event never journaled its started.
2. **Mid-retry terminal loss.** Loop re-runs and routine retries replace
   agents while the overlay stays open; if the overlay closed between
   iterations (or the routine outlived a re-connect), the next run's
   terminals never reached a journal.
3. **Headless never journals.** With no TUI (`ctx.hasUI` false - CLI
   sessions, subprocess routines), no overlay exists at all, so no journal
   was ever written for the whole routine.
4. **Multi-dir scatter.** Whether a journal landed in the shared stream
   dir depended on which state instance (overlay vs replay) happened to
   hold the writer at emit time, making discovery and retention fragile.

The root cause is architectural: journal writes were gated on the TUI
viewer's subscription lifetime instead of the routine's. The writer must
live for the whole routine regardless of display state.

## Decision

- **D1 - A recorder at the routine layer is the single journal writer.**
  `AgentJournalRecorder` (`cli/src/tui/state/AgentJournalRecorder.ts`)
  subscribes to the same `feature-forge:agent-started` /
  `agent-stream` / `agent-done` channels the viewer wiring consumes, and
  derives journal entries through the tested `AgentViewerState` write
  paths (`appendLifecycle` / `pushStreamEvent`). `RoutineTool.execute`
  creates and subscribes it _before_ `executor.run` spawns any agent, and
  disposes it in `finally` - the recorder's lifetime is the routine's, not
  the overlay's, so the first agent's started is always captured (fixes
  pre-connect loss), retries re-run against a still-subscribed recorder
  (fixes mid-retry terminal loss), headless routines journal because the
  recorder needs no `ctx.ui` (fixes headless never journals), and one
  recorder owns the shared stream dir for the whole routine (fixes
  multi-dir scatter). Recorder setup is best-effort: a failure to resolve
  the shared stream dir or subscribe degrades to "no journaling" with a
  warning and never breaks the routine.
- **D2 - Journaling gate on `AgentViewerState`; display states are
  read-only.** `AgentViewerState.setJournaling` gates journal writes.
  Display states (the overlay's own state) call `setJournaling(false)`:
  streamDir then serves replay reads only (`prepopulateStreamFiles`,
  loaders) and live events never touch the disk. The recorder calls
  `setJournaling(true)` and is the sole opted-in writer. One deliberate
  exception: replay-time legacy migration
  (`prepopulateStreamFiles` -> `AgentJournal.migrateLegacy`) still writes
  journal files when legacy `.stream` / `.messages.jsonl` / `.events`
  files exist, because display replay must fold legacy agents regardless
  of the gate.
- **D3 - Terminal encoding is payload-truthful: `done` always, `passed`
  and `summary` carried verbatim.** The recorder's `agent-done` handler
  journals lifecycle phase `done` for EVERY agent-done and carries
  `passed` + `summary` from the payload. Rationale: `AgentStepExecutor`
  emits `agent-done` with `passed:false` for BOTH hard failures (the
  catch path) AND completed-but-negative-verdict agents (e.g. a verify
  agent whose checks fail: supervisor status Completed, JSON
  `passed:false`) - the payload alone cannot distinguish them. Encoding
  `passed:false` as phase `error` would drop `passed` at replay (status
  `error` + errorMessage), losing the negative-verdict distinction and the
  verify summary (the acceptance evidence). The recorder has no
  agentQuery/fleet status (by design - it is display-agnostic), so the
  truthful encoding is `done` + `passed:false` + summary; replay renders
  the entry as a completed-but-failed verdict instead of inventing an
  error terminal. `error` / `cancelled` lifecycle encodings remain future
  work requiring a terminal-status channel the recorder does not have
  (ADR 0023 D2 already tolerates those phases at replay).
- **D4 - Supersedes ADR 0023 D3's write path.** ADR 0023 D3 named the
  overlay's `deliverStatusEvent` funnel as the single write path for
  lifecycle entries. That role now belongs to the routine-layer recorder
  (D1): lifecycle entries still come only from real wire events (the
  recorder never synthesizes status from agentQuery or replay), but the
  writer is the recorder, and the overlay funnel only updates display
  state. ADR 0023's other replay/format decisions are unchanged.

## Consequences

- Journal completeness no longer depends on the TUI viewer: routines that
  run headless, open the overlay late, retry agents, or outlive a
  re-connect all journal every agent run from started to its terminal.
- Display and persistence are decoupled: the overlay renders and replays
  from journals without being able to write them, and the recorder
  persists without needing a display - a single writer per routine means
  no interleaved appends from competing state instances.
- Terminal truthfulness at replay: a negative-verdict agent (e.g. verify
  checks failing) replays as status `done` with `passed:false` and its
  summary intact - distinct from a hard `error` terminal, which the
  current bus payloads cannot express anyway.
- Best-effort degradation is preserved: recorder setup failure logs a
  warning and the routine proceeds without journaling, matching the
  viewer wiring's never-throw contract.
- New API surface: `AgentJournalRecorder` (subscribe/dispose, package
  internal to cli), `AgentViewerState.setJournaling`, and the recorder
  wiring inside `RoutineTool.execute`. `AgentJournal` /
  `RotatingFileSink` are untouched.

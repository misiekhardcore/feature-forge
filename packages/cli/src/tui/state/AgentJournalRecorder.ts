import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { TypedEventBus } from "@feature-forge/core/event-bus";

import { AgentDisplayHelpers } from "../display";
import { AgentViewerState } from "./AgentViewerState";

/**
 * Constructor parameters for an {@link AgentJournalRecorder}.
 */
export interface AgentJournalRecorderParams {
  /** Typed event bus the recorder subscribes to (agent lifecycle + stream channels). */
  eventBus: TypedEventBus;
  /** Directory where the per-agent journal files are written. */
  streamDir: string;
}

/**
 * Routine-lifetime agent journal recorder.
 *
 * The single disk writer for agent journals. It subscribes to the same
 * `feature-forge:agent-started` / `agent-stream` / `agent-done` channels
 * the viewer wiring consumes, and derives journal entries through the
 * tested {@link AgentViewerState} write paths - so the journal is complete
 * regardless of when (or whether) a TUI viewer opens: the recorder lives
 * for the whole routine, subscribes before the first agent spawns (no
 * pre-connect loss), and outlives any overlay teardown.
 *
 * It owns a private {@link AgentViewerState} in journaling mode (streamDir
 * configured, journaling enabled) and never serves a display, so its write
 * gate is never closed. Journal files are append-only and survive the
 * recorder's lifetime - dispose only unsubscribes and releases memory.
 *
 * Terminal encoding is payload-truthful: an `agent-done` event journals
 * lifecycle phase `done` regardless of its `passed` flag and carries
 * `passed` + `summary` verbatim, so a completed-but-failed run (passed:
 * false, supervisor status Completed) survives replay as a distinct
 * negative verdict with its summary intact. The recorder has no
 * agentQuery/fleet status (by design), so `error`/`cancelled` lifecycle
 * encodings are left to a future terminal-status channel.
 *
 * Best-effort by construction, but not individually wrapped: the delegation
 * targets (appendLifecycle, pushStreamEvent) are each defensive and never
 * throw, while the handler bodies themselves rely on pi's EventBus
 * swallowing listener errors - the same contract the overlay wiring
 * ({@code AgentViewerOverlay.wireOverlayEvents}) already relies on. A
 * failing handler therefore cannot interrupt agent execution.
 */
export class AgentJournalRecorder {
  private readonly state: AgentViewerState;
  private readonly eventBus: TypedEventBus;

  /** True while bus listeners are registered. */
  private active = false;

  /** True once {@link dispose} ran - a released recorder never re-subscribes. */
  private released = false;

  /** Per-channel unsubscribe callbacks returned by the event bus. */
  private unsubscribers: Array<() => void> = [];

  constructor(params: AgentJournalRecorderParams) {
    this.eventBus = params.eventBus;
    this.state = new AgentViewerState();
    // The recorder's state is the journaling writer by construction: streamDir
    // enables the journal-backed write path and journaling stays on - it never
    // doubles as a display, so the gate is never closed here.
    this.state.setStreamDir(params.streamDir);
    this.state.setJournaling(true);
  }

  /**
   * Subscribe the recorder to the agent lifecycle and stream channels.
   *
   * Idempotent: while active, repeated calls return without registering a
   * second set of listeners (each event is journaled exactly once). Returns
   * an unsubscribe function that stops journaling - equivalent to
   * {@link dispose}, safe to call repeatedly. A released recorder (after
   * dispose) ignores further subscribe calls and returns a no-op.
   */
  subscribe(): () => void {
    if (!this.released && !this.active) {
      this.active = true;
      const { eventBus, state } = this;

      // Same formatter the viewer uses for its stream lines (shared helper
      // in display/ - state must never import a view), so journaled lines
      // are byte-identical to what the overlay would have written.
      const formatStreamEvent = (event: JsonAgentSessionEvent): string =>
        AgentDisplayHelpers.formatStreamEvent(event);

      this.unsubscribers = [
        eventBus.on("feature-forge:agent-started", (payload) => {
          const agentId = payload.details.agentId;
          if (!agentId) return;
          state.appendLifecycle(agentId, "started");
        }),

        eventBus.on("feature-forge:agent-stream", (payload) => {
          const { agentId, event } = payload.details;
          if (!agentId || !event) return;
          state.pushStreamEvent(agentId, event, formatStreamEvent);
        }),

        eventBus.on("feature-forge:agent-done", (payload) => {
          const agentId = payload.details.agentId;
          if (!agentId) return;
          const passed = payload.details.passed;
          // Payload-truthful terminal encoding: journal phase "done" for
          // EVERY agent-done and carry passed + summary from the payload.
          // AgentStepExecutor emits agent-done with passed:false for BOTH
          // hard failures (the catch path) AND completed-but-negative-verdict
          // agents (e.g. a verify agent whose checks fail: supervisor status
          // Completed, JSON passed:false) - the payload alone cannot
          // distinguish them. Encoding passed:false as phase "error" would
          // drop passed at replay (status error + errorMessage) and lose the
          // negative-verdict distinction plus the verify summary (the AC
          // evidence). Error/cancelled encodings remain future work on a
          // terminal-status channel the recorder does not have.
          state.appendLifecycle(agentId, "done", passed, payload.details.summary);
        }),
      ];
    }
    return () => this.dispose();
  }

  /**
   * Stop journaling and release the recorder.
   *
   * Unsubscribes every bus listener and releases the internal state.
   * Journal files already written stay on disk - they are the persistent
   * record of the agent run and survive the recorder's lifetime. Idempotent;
   * a released recorder never re-subscribes.
   */
  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.active = false;
    const unsubscribers = this.unsubscribers;
    this.unsubscribers = [];
    for (const unsubscribe of unsubscribers) unsubscribe();
    this.state.dispose();
  }
}

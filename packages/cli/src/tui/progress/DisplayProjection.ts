import type { RoutineProgressEvent } from "@feature-forge/core/src/routines/RoutineProgress";

import type { AccumulatedState } from "./AccumulatedState";

/**
 * Fold a single {@link RoutineProgressEvent} into an {@link AccumulatedState}.
 *
 * This is the single display pipeline entry point: the routine tool forwards
 * every progress event here, and the renderer reads the resulting accumulated
 * state. The projection is a deterministic fold over the event stream — the
 * only mutation is writes to the passed-in state object.
 *
 * Stream-only events ("agent-stream" chunks) are deliberate no-ops: they are
 * high-frequency and carry no structural state transition.
 */
export function applyEvent(state: AccumulatedState, event: RoutineProgressEvent): void {
  switch (event.phase) {
    case "agent-started":
    case "agent-done": {
      const details = event.details as {
        agentId?: string;
        summary?: string;
        passed?: boolean;
      };
      if (details.agentId) {
        state.agentMap.set(
          details.agentId,
          event.phase === "agent-started"
            ? { status: "started" }
            : { status: "done", summary: details.summary, passed: details.passed },
        );
      }
      return;
    }

    // agent-stream chunks carry no state transition — no-op (preserved from
    // the legacy pipeline, which skipped stream-only contributions).
    case "agent-stream":
      return;

    case "workspace-ready": {
      const details = event.details as { path?: unknown; branch?: string };
      if (typeof details.path === "string") {
        state.workspace = details.path;
      }
      if (details.branch !== undefined) {
        state.branch = details.branch;
      }
      return;
    }

    case "cleanup-done": {
      const details = event.details as { workspace?: unknown };
      if (typeof details.workspace === "string") {
        state.workspace = details.workspace;
      }
      return;
    }

    case "session-set": {
      const { key, value } = event.details;
      state.resultSnippet = state.resultSnippet
        ? `${state.resultSnippet}, ${key}: ${value}`
        : `${key}: ${value}`;
      return;
    }

    case "routine-ref-start": {
      const flow = event.details.flow;
      if (flow) {
        state.routineRefs.push(flow);
      }
      return;
    }

    default: {
      // Any "loop-*" phase (loop-round-start, loop-round-complete, ...)
      // carries iteration state — same handling for all of them, matching
      // the legacy LoopStepExecutor contribution for every "loop-" phase.
      if (event.phase.startsWith("loop-")) {
        const details = event.details as {
          round?: number;
          maxIterations?: number;
          continueWhile?: string;
        };
        state.iteration = (details.round ?? 1) - 1;
        if (typeof details.maxIterations === "number") {
          state.maxIterations = details.maxIterations;
        }
        if (details.continueWhile !== undefined) {
          state.continueWhile = details.continueWhile;
        }
      }
      // Everything else (shell-done, parallel-*, git-*, routine-ref-done/
      // error, ...) is a no-op.
      return;
    }
  }
}

import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/core";
import type { ForgeChannels, TypedEventBus } from "@feature-forge/core/event-bus";
import type { FlowParams } from "@feature-forge/core/flows";
import type { RoutineProgressEvent, RoutineResult } from "@feature-forge/core/routines";

import type { AccumulatedState } from "./AccumulatedState";
import { createAccumulatedState } from "./AccumulatedState";
import { applyEvent } from "./DisplayProjection";
import type { RoutineProgressState } from "./RoutineProgressState";

/**
 * Channels the handler subscribes to for contribution accumulation and
 * progress widget rendering. Agent channels are included so the widget
 * shows agent lifecycle status — the overlay is driven separately via
 * {@link import("../showAgentViewer").showAgentViewer}.
 */
const PROGRESS_CHANNELS = [
  "feature-forge:workspace-ready",
  "feature-forge:agent-started",
  "feature-forge:agent-stream",
  "feature-forge:agent-done",
  "feature-forge:loop-round-start",
  "feature-forge:loop-round-complete",
  "feature-forge:parallel-start",
  "feature-forge:parallel-done",
  "feature-forge:cleanup-start",
  "feature-forge:cleanup-done",
  "feature-forge:git-start",
  "feature-forge:git-done",
  "feature-forge:shell-start",
  "feature-forge:shell-done",
  "feature-forge:session-set",
  "feature-forge:routine-ref-start",
  "feature-forge:routine-ref-done",
  "feature-forge:routine-ref-error",
] as const;

/**
 * Compile-time parity guard between {@link ForgeChannels} and
 * {@link PROGRESS_CHANNELS}. The display pipeline must never silently miss a
 * channel: adding or removing a channel in ForgeChannels without updating
 * PROGRESS_CHANNELS fails typecheck instead of degrading the UI.
 */
type AssertAllForgeChannelsCovered = [keyof ForgeChannels] extends [
  (typeof PROGRESS_CHANNELS)[number],
]
  ? true
  : never;
type AssertNoExtraChannels = [(typeof PROGRESS_CHANNELS)[number]] extends [keyof ForgeChannels]
  ? true
  : never;
const _assertChannelParity: [AssertAllForgeChannelsCovered, AssertNoExtraChannels] = [true, true];

/** Constructor options for {@link RoutineProgressFeed}. */
export interface RoutineProgressFeedOptions {
  /** Routine name (e.g. "run_build_loop") — fallback for onUpdate details. */
  routineName: string;
  /** Typed event bus the feed subscribes to. */
  eventBus: TypedEventBus;
  /** Lazily captured flow session state, forwarded into onUpdate details. */
  session: () => Record<string, unknown>;
  /** Streams partial results back to the tool caller (e.g. the orchestrator LLM). */
  onUpdate?: AgentToolUpdateCallback<RoutineResult>;
  /** Invoked when an event carries an `agentId` (agent lifecycle events). */
  onAgentEvent?: () => void;
  /** Invoked after each event is folded into the accumulated state. */
  onProgress?: () => void;
}

/**
 * Owns the routine progress event stream: subscriptions, the
 * {@link import("./DisplayProjection").applyEvent} fold, and the accumulated
 * display state exposed through {@link RoutineProgressState}.
 *
 * Implements {@link RoutineProgressState} so the {@link ProgressRenderer}
 * can read live state without coupling to the tool's internal structure.
 *
 * Constructed per execution; {@link subscribe} resets the accumulated state
 * and registers one handler on every {@link PROGRESS_CHANNELS} channel.
 */
export class RoutineProgressFeed implements RoutineProgressState {
  private state: AccumulatedState = createAccumulatedState();

  constructor(private readonly options: RoutineProgressFeedOptions) {}

  /** Routine name (e.g. "run_build_loop"). */
  get routineName(): string {
    return this.options.routineName;
  }

  /** Accumulated display state folded from the event stream. */
  get accumulatedState(): AccumulatedState {
    return this.state;
  }

  /** Replace the accumulated state with a fresh empty one. */
  reset(): void {
    this.state = createAccumulatedState();
  }

  /**
   * Reset the accumulated state and register the progress handler on every
   * {@link PROGRESS_CHANNELS} channel.
   *
   * @returns An unsubscribe function that removes every registered listener.
   */
  subscribe(): () => void {
    this.reset();

    // Read lazily on the first progress event — the flag is only needed when
    // a debug entry is actually written, so avoid config access otherwise.
    let logPayloads: boolean | undefined;
    const handler = (data: unknown): void => {
      const event = data as RoutineProgressEvent;

      // Agent lifecycle events (agent-started/stream/done) carry `agentId` in
      // their details; all other phases don't. Notify the owner so it can
      // react (e.g. open the agent viewer overlay) on the first such event.
      const agentId = (event.details as { agentId?: string }).agentId;
      if (agentId) this.options.onAgentEvent?.();

      logPayloads ??= ForgeConfig.getInstance().getLogPayloads();
      logger.debug(
        "RoutineTool progress",
        logPayloads ? { ...event } : { phase: event.phase, message: event.message },
      );

      // Fold the event into the accumulated display state. Stream-only
      // events (agent-stream chunks) are no-ops in the projection.
      applyEvent(this.state, event);

      this.options.onProgress?.();

      if (this.options.onUpdate) {
        const resultDetails = event.details as Partial<RoutineResult>;
        this.options.onUpdate({
          content: [
            {
              type: "text",
              text: `[${event.phase}] ${event.message}`,
            },
          ],
          details: {
            routine: resultDetails.routine ?? this.options.routineName,
            passed: resultDetails.passed ?? false,
            status: resultDetails.status ?? "success",
            rounds: resultDetails.rounds ?? 0,
            workspace: resultDetails.workspace,
            results: {},
            summary: resultDetails.summary ?? "",
            // Session is captured through the lazy getter; the details contract
            // expects FlowParams (Record<string, string>), so widen at the edge.
            session: this.options.session() as FlowParams,
          },
        });
      }
    };

    const unsubscribers = PROGRESS_CHANNELS.map((channel) =>
      this.options.eventBus.on(channel, handler),
    );
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }
}

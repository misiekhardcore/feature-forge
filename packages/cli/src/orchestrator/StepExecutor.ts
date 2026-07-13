import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
import type { DisplayContribution } from "./progress/DisplayContribution";
import type { DisplayContributionRegistry } from "./progress/DisplayContributionRegistry";
import type { RoutineProgressEvent } from "./RoutineProgress";

/**
 * Executes a single deterministic flow instruction against an immutable context,
 * returning a new context with the instruction's result recorded.
 *
 * Implementations are stateless — all state lives in {@link FlowContext}.
 */
export abstract class StepExecutor<TInstruction extends FlowInstruction = FlowInstruction> {
  /** The instruction type this executor handles (e.g. "agent", "loop"). */
  abstract readonly type: string;

  /**
   * Execute the instruction and return the updated context.
   *
   * @param instruction — The instruction to execute (narrowed to the executor's type).
   * @param context — Immutable context carrying current results/workspaces/params.
   * @param executeStep — Dispatch callback for container executors (loop, parallel).
   * @param eventBus — Event bus for streaming progress events.
   * @param signal — Optional abort signal for cancelling long-running operations.
   * @returns A new context with this instruction's result recorded.
   */
  abstract execute(
    instruction: TInstruction,
    context: FlowContext,
    executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext>;

  /**
   * Extract display-relevant fields from a progress event.
   *
   * Each concrete executor returns a {@link DisplayContribution} with the
   * subset of fields it owns (agents return agentId/status, loops return
   * iteration info, workspaces return the path). The default returns
   * `undefined`, meaning "no contribution".
   *
   * Consumers iterate all executors in the registry, call this for each
   * event, and merge non-undefined contributions into an accumulated
   * display snapshot.
   */
  getDisplayContribution(_event: RoutineProgressEvent): DisplayContribution | undefined {
    return undefined;
  }

  /**
   * Register a handler for the contribution type produced by this executor.
   *
   * Called during initialisation to populate a
   * {@link DisplayContributionRegistry} with type-specific handlers that
   * update an {@link import("./progress/AccumulatedState").MutableState}.
   *
   * The default implementation is a no-op. Executors that override
   * {@link getDisplayContribution} should also override this method to
   * register the corresponding handler.
   *
   * @param registry — The registry to register the handler with.
   */
  registerDisplayHandler(_registry: DisplayContributionRegistry): void {
    // No-op by default.
  }
}

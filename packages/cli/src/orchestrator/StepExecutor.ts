import type { DisplayContribution } from "@feature-forge/tui";
import type { DisplayContributionRegistry } from "@feature-forge/tui";

import type { TypedEventBus } from "./eventBus";
import type { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
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
   * @param eventBus — Typed event bus for streaming progress events.
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
    eventBus: TypedEventBus,
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
   * Register a handler on the given registry that applies this executor's
   * contribution type to an {@link import("./progress/AccumulatedState").AccumulatedState}.
   *
   * The default is a no-op. Override in executors that produce
   * {@link DisplayContribution} instances so consumer code (e.g.
   * {@link import("./progress/ProgressRenderer").ProgressRenderer}) can
   * build an accumulated snapshot via
   * {@link DisplayContributionRegistry.apply}.
   */
  registerDisplayHandler(_registry: DisplayContributionRegistry): void {
    // no-op by default
  }
}

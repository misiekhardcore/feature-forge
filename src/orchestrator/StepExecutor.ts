import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";

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
}

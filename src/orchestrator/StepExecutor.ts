import type { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";

/**
 * Executes a single step in a flow routine.
 *
 * Each concrete executor handles one instruction type (workspace, agent, etc.).
 * Container executors (parallel, loop) use the {@link executeStep} callback to
 * recursively execute their child steps.
 *
 * @typeParam TInstruction — the specific instruction type this executor handles (defaults to FlowInstruction).
 */
export abstract class StepExecutor<TInstruction extends FlowInstruction = FlowInstruction> {
  /** The instruction type this executor handles (e.g., "workspace", "agent"). */
  abstract readonly type: string;

  /**
   * Execute one flow instruction against the current context.
   *
   * @param instruction — the flow instruction to execute
   * @param context — the current (immutable) flow context
   * @param executeStep — callback for executing child steps (used by container executors)
   * @returns a new FlowContext with any state updates applied
   */
  abstract execute(
    instruction: TInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext>;
}

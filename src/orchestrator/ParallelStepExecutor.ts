import type { FlowContext } from "./FlowContext";
import type { FlowInstruction, ParallelInstruction } from "./FlowInstruction";
import { containerSteps } from "./helpers";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a `parallel` instruction by running all child steps concurrently
 * and merging their results into a single context.
 *
 * Each child step starts from the same incoming context. Results from all
 * branches are merged into the returned context.
 */
export class ParallelStepExecutor extends StepExecutor {
  readonly type = "parallel";

  override async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const _parallelInstruction = instruction as ParallelInstruction;
    const steps = containerSteps(instruction);

    const branchContexts = await Promise.all(steps.map((step) => executeStep(step, context)));

    let merged = context;
    for (const branchCtx of branchContexts) {
      for (const [id, result] of branchCtx.results) {
        if (!merged.results.has(id)) {
          merged = merged.withResult(id, result);
        }
      }
    }

    return merged;
  }
}

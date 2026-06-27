import { ExpressionEvaluator } from "./ExpressionEvaluator";
import type { FlowContext } from "./FlowContext";
import type { FlowInstruction, LoopInstruction } from "./FlowInstruction";
import { collectAllIds, containerSteps } from "./helpers";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a `loop` instruction by iterating its child steps up to
 * `maxIterations` times, evaluating `continueWhile` after each full
 * iteration.
 *
 * Between iterations, results from the previous iteration are cleared
 * and feedback is accumulated from `accumulateFrom` result ids.
 */
export class LoopStepExecutor extends StepExecutor {
  readonly type = "loop";

  override async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const loopInstruction = instruction as LoopInstruction;
    const steps = containerSteps(instruction);

    const allStepIds = collectAllIds(steps);
    let currentCtx = context;

    for (let iteration = 0; iteration < loopInstruction.maxIterations; iteration++) {
      currentCtx = currentCtx.withIteration(iteration);

      if (iteration > 0) {
        currentCtx = currentCtx.withResultsCleared(new Set(allStepIds));
      }

      for (const step of steps) {
        currentCtx = await executeStep(step, currentCtx);
      }

      if (loopInstruction.continueWhile) {
        const shouldContinue = ExpressionEvaluator.evaluateExpression(
          loopInstruction.continueWhile,
          {
            results: currentCtx.results as unknown as Map<
              string,
              { raw: string; parsed?: { passed: boolean } }
            >,
          },
        );
        if (!shouldContinue) break;
      } else {
        break;
      }

      if (loopInstruction.accumulateFrom && loopInstruction.accumulateFrom.length > 0) {
        const feedbackParts: string[] = [];
        for (const id of loopInstruction.accumulateFrom) {
          const result = currentCtx.results.get(id);
          if (result) {
            if (result.parsed) {
              feedbackParts.push(JSON.stringify(result.parsed));
            } else if (result.raw) {
              feedbackParts.push(result.raw);
            }
          }
        }
        if (feedbackParts.length > 0) {
          currentCtx = currentCtx.withFeedback(feedbackParts.join("\n\n"));
        }
      }
    }

    return currentCtx;
  }
}

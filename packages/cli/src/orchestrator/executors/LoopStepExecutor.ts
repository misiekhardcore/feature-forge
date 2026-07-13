import { logger } from "../../logging";
import type { TypedEventBus } from "../eventBus";
import { ExpressionEvaluator } from "../ExpressionEvaluator";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, LoopInstruction } from "../FlowInstruction";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";
import { collectAllIds } from "./helpers";

/**
 * Executes a "loop" instruction by repeatedly running its body steps,
 * evaluating {@link LoopInstruction.continueWhile} after each iteration,
 * and respecting {@link LoopInstruction.maxIterations}.
 *
 * After each iteration, results from steps listed in
 * {@link LoopInstruction.accumulateFrom} are concatenated into
 * {@link FlowContext.feedback} for the next round.
 */
export class LoopStepExecutor extends StepExecutor<LoopInstruction> {
  readonly type = "loop";

  async execute(
    instruction: LoopInstruction,
    context: FlowContext,
    executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    const maxIterations = instruction.maxIterations;
    const continueWhileExpr = instruction.continueWhile;
    const accumulateFrom = instruction.accumulateFrom ?? [];

    logger.info("Starting loop", {
      id: instruction.id,
      maxIterations,
      hasContinueWhile: !!continueWhileExpr,
      accumulateFrom,
    });

    let current = context;

    // Track all result ids produced across iterations so we can clear
    // stale results between rounds.
    const bodyIds = collectAllIds(instruction.steps);

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Check abort signal before each iteration.
      signal?.throwIfAborted();

      // Clear body results from the previous iteration before starting
      // the next one. The first iteration has nothing to clear so results
      // from the final iteration are preserved.
      if (iteration > 0) {
        current = current.withResultsCleared(bodyIds);
      }

      current = current.withIteration(iteration + 1);

      logger.debug("Loop iteration", { id: instruction.id, iteration, maxIterations });

      eventBus.emit("feature-forge:loop-round-start", {
        phase: "loop-round-start",
        message: `Loop "${instruction.id}" — round ${iteration + 1}/${maxIterations}`,
        details: {
          round: iteration + 1,
          maxIterations,
          ...(continueWhileExpr ? { continueWhile: continueWhileExpr } : {}),
        },
      });

      // Execute each body step in sequence.
      for (const step of instruction.steps) {
        current = await executeStep(step, current, signal);
      }

      // Build feedback from accumulated results.
      eventBus.emit("feature-forge:loop-round-complete", {
        phase: "loop-round-complete",
        message: `Loop "${instruction.id}" — round ${iteration + 1} complete`,
        details: {
          round: iteration + 1,
          maxIterations,
          ...(continueWhileExpr ? { continueWhile: continueWhileExpr } : {}),
        },
      });

      if (accumulateFrom.length > 0) {
        const lines: string[] = [];
        if (current.feedback) {
          lines.push(current.feedback);
        }
        lines.push(`--- iteration ${iteration + 1} ---`);
        for (const id of accumulateFrom) {
          const result = current.results.get(id);
          if (result) {
            lines.push(`${id}: ${result.raw}`);
          }
        }
        current = current.withFeedback(lines.join("\n"));
      }

      // Evaluate continueWhile expression after every iteration.
      // When the loop should NOT continue, break to preserve the final
      // iteration's results.
      if (continueWhileExpr) {
        const shouldContinue = ExpressionEvaluator.evaluateExpression(
          current.resolve(continueWhileExpr),
          current,
        );
        logger.debug("Loop continueWhile evaluated", {
          id: instruction.id,
          iteration,
          expression: continueWhileExpr,
          shouldContinue,
        });
        if (!shouldContinue) {
          logger.info("Loop finished early via continueWhile", {
            id: instruction.id,
            iterations: iteration + 1,
          });
          break;
        }
      }
    }

    // Record a summary result for the loop itself.
    const loopResult: InstructionResult = {
      raw: JSON.stringify({ iterations: current.iteration, maxIterations }),
      parsed: {
        passed: true,
        summary: `Loop completed ${current.iteration} iteration(s)`,
      },
    };

    return current.withResult(instruction.id, loopResult);
  }

  /**
   * Extract loop iteration info from a progress event.
   *
   * Only contributes for {@code loop-round-*} phase events.
   */
  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (!event.phase.startsWith("loop-")) {
      return undefined;
    }
    const details = event.details as {
      rounds?: number;
      maxIterations?: number;
      continueWhile?: string;
    };
    const maxIterations = typeof details.maxIterations === "number" ? details.maxIterations : 0;
    return {
      iteration: (details.rounds ?? 1) - 1,
      maxIterations,
      continueWhile: details.continueWhile,
      phase: event.phase,
      message: event.message,
    };
  }
}

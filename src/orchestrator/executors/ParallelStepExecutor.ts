import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, ParallelInstruction } from "../FlowInstruction";
import type { RoutineProgress } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "parallel" instruction by running all child steps concurrently.
 *
 * Each child is dispatched independently; aggregation waits for all to settle.
 * If any child throws, the error is propagated after all siblings complete.
 */
export class ParallelStepExecutor extends StepExecutor<ParallelInstruction> {
  readonly type = "parallel";

  async execute(
    instruction: ParallelInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
    onProgress?: RoutineProgress,
  ): Promise<FlowContext> {
    const childInstructions = instruction.steps;

    logger.info("Executing parallel block", {
      id: instruction.id,
      childCount: childInstructions.length,
    });

    if (onProgress) {
      onProgress({
        phase: "parallel-start",
        message: `Parallel block "${instruction.id}" — ${childInstructions.length} child(ren)`,
        details: {},
      });
    }

    const settled = await Promise.allSettled(
      childInstructions.map(async (child) => executeStep(child, context)),
    );

    // Collect errors; throw the first one after all settle.
    let firstError: Error | undefined;
    for (const result of settled) {
      if (result.status === "rejected") {
        const err =
          result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        logger.error("Child step failed in parallel block", { id: instruction.id, error: err });
        firstError ??= err;
      }
    }

    if (firstError) {
      throw firstError;
    }

    // Merge results from all successful branches.
    let merged = context;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        const childContext = result.value;
        for (const [key, value] of childContext.results) {
          merged = merged.withResult(key, value);
        }
        for (const [key, handle] of childContext.workspaces) {
          merged = merged.withWorkspace(key, handle);
        }
      }
    }

    // Record a summary result for the parallel block itself.
    const childIds = childInstructions.map((c) => c.id);

    const blockResult: InstructionResult = {
      raw: JSON.stringify({ passed: true, children: childIds }),
      parsed: {
        kind: "build",
        passed: true,
        summary: `All ${childInstructions.length} parallel steps completed`,
      },
    };

    const finalContext = merged.withResult(instruction.id, blockResult);

    if (onProgress) {
      onProgress({
        phase: "parallel-done",
        message: `Parallel block "${instruction.id}" complete`,
        details: {},
      });
    }

    return finalContext;
  }
}

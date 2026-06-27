import { logger } from "../../logging";
import type { BuildOutcome, FlowContext, InstructionResult, ReviewFindings } from "../FlowContext";
import type { ParallelInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import type { StepExecutorRegistry } from "../StepExecutorRegistry";

/**
 * Executes a "parallel" instruction by running all child steps concurrently
 * via the {@link StepExecutorRegistry}.
 *
 * Each child is dispatched independently; aggregation waits for all to settle.
 * If any child throws, the error is propagated after all siblings complete.
 */
export class ParallelStepExecutor extends StepExecutor<ParallelInstruction> {
  readonly type = "parallel";

  constructor(private readonly stepRegistry: StepExecutorRegistry) {
    super();
  }

  async execute(instruction: ParallelInstruction, context: FlowContext): Promise<FlowContext> {
    const childInstructions = instruction.steps;

    logger.info("Executing parallel block", {
      id: instruction.id,
      childCount: childInstructions.length,
    });

    const settled = await Promise.allSettled(
      childInstructions.map(async (child) => {
        const executor = this.stepRegistry.get(child.type);
        if (!executor) {
          throw new Error(`No executor registered for step type "${child.type}"`);
        }
        return executor.execute(child, context);
      }),
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
    const passed = firstError === undefined;
    const blockResult: InstructionResult = {
      raw: JSON.stringify({ passed, children: childIds }),
      parsed: passed
        ? ({
            kind: "build" as const,
            passed: true,
            summary: `All ${childInstructions.length} parallel steps completed`,
          } satisfies BuildOutcome)
        : ({
            kind: "review" as const,
            passed: false,
            findings: { critical: [firstError!.message], warnings: [], info: [] },
          } satisfies ReviewFindings),
    };

    return merged.withResult(instruction.id, blockResult);
  }
}

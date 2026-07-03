import type { FlowContext, InstructionResult } from "./FlowContext";
import type { FlowInstruction, ParallelInstruction } from "./FlowInstruction";
import { containerSteps } from "./helpers";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a `parallel` instruction by running all child steps concurrently
 * and merging their results into a single context.
 *
 * Supports three failure modes:
 * - `fail_fast` (default): first rejection throws — identical to prior behaviour.
 * - `continue_on_error`: never throws; records a block-level result with
 *   `parsed.passed = (successes >= 1)` and a `failures` map in `raw`.
 * - `all_or_nothing`: never throws; records a block-level result with
 *   `parsed.passed = (errors === 0)` on partial failure. All-success path
 *   is identical to today (no block result).
 */
export class ParallelStepExecutor extends StepExecutor<ParallelInstruction> {
  readonly type = "parallel";

  override async execute(
    instruction: ParallelInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const steps = containerSteps(instruction);
    const failureMode = instruction.failureMode ?? "fail_fast";

    switch (failureMode) {
      case "fail_fast": {
        // Current behaviour: Promise.all propagates first rejection.
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

      case "continue_on_error":
      case "all_or_nothing": {
        const results = await Promise.allSettled(steps.map((step) => executeStep(step, context)));

        const successes: FlowContext[] = [];
        const failures: Record<string, string> = {};

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            successes.push(result.value);
          } else {
            failures[steps[i].id] =
              result.reason instanceof Error ? result.reason.message : String(result.reason);
          }
        }

        // Merge only successes' results.
        let merged = context;
        for (const branchCtx of successes) {
          for (const [id, result] of branchCtx.results) {
            if (!merged.results.has(id)) {
              merged = merged.withResult(id, result);
            }
          }
        }

        const errorCount = Object.keys(failures).length;
        const allSucceeded = errorCount === 0;

        // all_or_nothing all-success → identical to today's success path.
        if (failureMode === "all_or_nothing" && allSucceeded) {
          return merged;
        }

        // Produce a block-level result.
        const passed = failureMode === "continue_on_error" ? successes.length >= 1 : allSucceeded;

        const blockResult: InstructionResult = {
          raw: errorCount > 0 ? JSON.stringify({ failures }) : "",
          parsed: {
            kind: "build",
            passed,
            summary: passed
              ? `${successes.length} succeeded, ${errorCount} failed`
              : `All ${errorCount} branches failed`,
          },
        };

        merged = merged.withResult(instruction.id, blockResult);
        return merged;
      }
    }
  }
}

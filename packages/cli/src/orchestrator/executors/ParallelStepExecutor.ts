import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, ParallelInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import { isAbortError } from "./isAbortError";

/**
 * Executes a `parallel` instruction by running all child steps concurrently
 * and merging their results into a single context.
 *
 * Supports three failure modes:
 * - `fail_fast` (default): throws the first child rejection after all settle.
 * - `continue_on_error`: never throws; records block-level result with
 *   `parsed.passed = (successes >= 1)` and a `failures` map in `raw`.
 * - `all_or_nothing`: never throws; records block-level result with
 *   `parsed.passed = (errors === 0)` on partial failure. All-success path
 *   is identical to today (no block result).
 */
export class ParallelStepExecutor extends StepExecutor<ParallelInstruction> {
  readonly type = "parallel";

  async execute(
    instruction: ParallelInstruction,
    context: FlowContext,
    executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    const childInstructions = instruction.steps;
    const failureMode = instruction.failureMode ?? "fail_fast";

    logger.info("Executing parallel block", {
      id: instruction.id,
      childCount: childInstructions.length,
      failureMode,
    });

    eventBus.emit("feature-forge:parallel-start", {
      phase: "parallel-start",
      message: `Parallel block "${instruction.id}" — ${childInstructions.length} child(ren)`,
      details: {},
    });

    // Check abort signal before dispatching parallel children.
    signal?.throwIfAborted();

    const settled = await Promise.allSettled(
      childInstructions.map(async (child) => executeStep(child, context, signal)),
    );

    // Propagate abort signals immediately so the routine can be cancelled
    // without waiting for the current parallel block to finish.
    for (const result of settled) {
      if (result.status === "rejected" && isAbortError(result.reason)) {
        throw result.reason;
      }
    }

    // Collect errors and successes.
    const successes: FlowContext[] = [];
    const failures: Map<string, string> = new Map();
    let firstError: Error | undefined;

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === "fulfilled") {
        successes.push(result.value);
      } else {
        const childId = childInstructions[i].id;
        const message =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.set(childId, message);

        const err =
          result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        logger.error("Child step failed in parallel block", { id: instruction.id, error: err });
        firstError ??= err;
      }
    }

    // fail_fast: throw on first error (current behaviour).
    if (failureMode === "fail_fast" && firstError) {
      throw firstError;
    }

    // Merge results and workspaces from successful branches.
    let merged = context;
    for (const childContext of successes) {
      for (const [key, value] of childContext.results) {
        merged = merged.withResult(key, value);
      }
      for (const [key, handle] of childContext.workspaces) {
        merged = merged.withWorkspace(key, handle);
      }
    }

    const errorCount = failures.size;
    const allSucceeded = errorCount === 0;

    // all_or_nothing all-success -> produce standard block result
    // (compatible with today's output shape).
    if (failureMode === "all_or_nothing" && allSucceeded) {
      const childIds = childInstructions.map((c) => c.id);
      const blockResult: InstructionResult = {
        raw: JSON.stringify({ passed: true, children: childIds }),
        parsed: {
          passed: true,
          summary: `All ${childInstructions.length} parallel steps completed`,
        },
      };

      const finalContext = merged.withResult(instruction.id, blockResult);

      eventBus.emit("feature-forge:parallel-done", {
        phase: "parallel-done",
        message: `Parallel block "${instruction.id}" complete`,
        details: {},
      });

      return finalContext;
    }

    // Build block-level result reflecting the failure mode.
    const passed =
      failureMode === "continue_on_error"
        ? successes.length >= 1
        : /* all_or_nothing */ allSucceeded;

    const failuresObj = Object.fromEntries(failures);
    const childIds = childInstructions.map((c) => c.id);

    const blockResult: InstructionResult = {
      raw:
        errorCount > 0
          ? JSON.stringify({ passed, children: childIds, failures: failuresObj })
          : JSON.stringify({ passed, children: childIds }),
      parsed: {
        passed,
        summary: allSucceeded
          ? `All ${childInstructions.length} parallel steps completed`
          : passed
            ? `${successes.length} succeeded, ${errorCount} failed`
            : `All ${errorCount} branches failed`,
      },
    };

    const finalContext = merged.withResult(instruction.id, blockResult);

    eventBus.emit("feature-forge:parallel-done", {
      phase: "parallel-done",
      message: `Parallel block "${instruction.id}" complete${!allSucceeded ? " (partial)" : ""}`,
      details: {},
    });

    return finalContext;
  }
}

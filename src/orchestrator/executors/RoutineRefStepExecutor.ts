import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import type { FlowContext } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a cross-flow routine reference instruction by forking a child
 * context and dispatching the target routine's steps through the same
 * {@code executeStep} callback.
 *
 * Callee results are merged as direct properties on the result object
 * stored under the instruction id, enabling dot-notation access like
 * {@code results.inspect.review.parsed.passed} in {@code continueWhile}
 * expressions.
 */
export class RoutineRefStepExecutor extends StepExecutor<RoutineRefInstruction> {
  readonly type = "routine";

  constructor(private readonly flows: ReadonlyMap<string, FlowDefinition>) {
    super();
  }

  async execute(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    // Resolve param values through the parent context so {{placeholder}}
    // tokens are replaced with actual values before the child routine runs.
    const resolvedParams: Record<string, string> = {};
    if (instruction.params) {
      for (const [key, value] of Object.entries(instruction.params)) {
        resolvedParams[key] = context.resolve(value);
      }
    }

    // Look up target flow and routine.
    const targetFlow = this.flows.get(instruction.flow);
    if (!targetFlow) {
      throw new Error(
        `Routine ref "${instruction.id}" references unknown flow "${instruction.flow}"`,
      );
    }

    const targetRoutine = targetFlow.routines[instruction.routine];
    if (!targetRoutine) {
      throw new Error(
        `Routine ref "${instruction.id}" references unknown routine ` +
          `"${instruction.routine}" in flow "${instruction.flow}"`,
      );
    }
    const steps = targetRoutine.steps as FlowInstruction[];

    logger.info("Executing cross-flow routine ref", {
      instructionId: instruction.id,
      targetFlow: instruction.flow,
      targetRoutine: instruction.routine,
      stepCount: steps.length,
    });

    // Fork a child context with the resolved params.
    let child = context.fork();
    child = child.withParams(resolvedParams);

    // Execute target routine steps sequentially.
    try {
      for (const step of steps) {
        signal?.throwIfAborted();
        child = await executeStep(step, child, signal);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Cross-flow routine step failed", {
        instructionId: instruction.id,
        targetFlow: instruction.flow,
        targetRoutine: instruction.routine,
        error: err,
      });
      const failureResult = {
        raw: err.message,
        parsed: {
          kind: "build" as const,
          passed: false,
          summary: `Routine ref "${instruction.id}" failed: ${err.message}`,
        },
      };
      return context.withResult(instruction.id, failureResult);
    }

    // Collect child step results into a plain map.
    const childResultMap: Record<string, unknown> = {};
    for (const [key, result] of child.results) {
      childResultMap[key] = result;
    }

    // Merge child results as direct properties on the result object —
    // enables dot-notation access like results.inspect.review.parsed.passed.
    const routineResult = Object.assign(
      {
        raw: JSON.stringify(childResultMap),
        parsed: {
          kind: "build" as const,
          passed: true,
          summary: `Routine ref "${instruction.routine}" from flow "${instruction.flow}" completed`,
        },
      },
      childResultMap,
    );

    return context.withResult(instruction.id, routineResult);
  }
}

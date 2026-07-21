import { logger } from "../../logging";
import type { TypedEventBus } from "../eventBus";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";
import { FlowMapAware } from "./FlowMapAware";
import { isAbortError } from "./isAbortError";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "./MaxDepthExceededError";

/**
 * Executes a `routine` instruction by inlining all routines from the
 * target flow into the parent's {@link FlowContext}.
 *
 * No child executor, no isolated context — steps from the sub-flow run
 * directly in the parent's context with the same params, results map,
 * and token resolution.
 */
export class RoutineRefStepExecutor
  extends StepExecutor<RoutineRefInstruction>
  implements FlowMapAware
{
  readonly type = "routine";

  /** Shared flow map keyed by flow name. Set via {@link setFlowMap}. */
  private flowMap: Map<string, FlowDefinition> = new Map();

  /** Expose the flowMap for DI. */
  setFlowMap(map: Map<string, FlowDefinition>): void {
    this.flowMap = map;
  }

  async execute(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    signal?.throwIfAborted();

    const targetFlow = this.flowMap.get(instruction.target);
    if (!targetFlow) {
      throw new Error(
        `Unknown target flow "${instruction.target}" ` +
          `referenced by routine ref "${instruction.id}"`,
      );
    }

    // Depth guard against infinite recursion.
    const newDepth = context.depth + 1;
    if (newDepth >= MAX_NESTING_DEPTH) {
      throw new MaxDepthExceededError(newDepth, MAX_NESTING_DEPTH, instruction.target);
    }

    const routineCount = targetFlow.routines.length;
    logger.info("Inlining routine ref", {
      id: instruction.id,
      target: instruction.target,
      routineCount,
      depth: newDepth,
    });

    eventBus.emit("feature-forge:routine-ref-start", {
      phase: "routine-ref-start",
      message: `Routine ref "${instruction.id}" → "${instruction.target}" (${routineCount} routine(s))`,
      details: { instructionId: instruction.id, target: instruction.target, flow: targetFlow.name },
    });

    let current = context.withDepth(newDepth);
    if (instruction.input) {
      current = current.withMergedParams(instruction.input);
    }
    let allPassed = true;
    const inlinedRoutineIds: string[] = [];

    try {
      for (const routine of targetFlow.routines) {
        const routineSteps = routine.steps as FlowInstruction[];
        for (const step of routineSteps) {
          // Namespace the step ID to prevent collision with parent steps.
          const namespacedStep: FlowInstruction = {
            ...step,
            id: `${instruction.id}.${instruction.target}.${step.id}`,
          };

          signal?.throwIfAborted();

          try {
            current = await executeStep(namespacedStep, current, signal);
          } catch (error) {
            if (isAbortError(error)) throw error;
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error("Inlined step failed", {
              target: instruction.target,
              step: namespacedStep.id,
              error: err,
            });

            eventBus.emit("feature-forge:routine-ref-error", {
              phase: "routine-ref-error",
              message: `Routine ref "${instruction.id}" failed at step "${namespacedStep.id}"`,
              details: {
                instructionId: instruction.id,
                target: instruction.target,
                flow: targetFlow.name,
                stepId: namespacedStep.id,
              },
            });

            throw error;
          }
        }
        inlinedRoutineIds.push(routine.id);
      }

      // Check if any inlined step result explicitly failed.
      for (const routine of targetFlow.routines) {
        const checkSteps = routine.steps as FlowInstruction[];
        for (const step of checkSteps) {
          const nsId = `${instruction.id}.${instruction.target}.${step.id}`;
          const result = current.results.get(nsId);
          if (result?.parsed?.passed === false) {
            allPassed = false;
            break;
          }
        }
        if (!allPassed) break;
      }
    } catch (error) {
      if (isAbortError(error)) throw error;

      // Record a failure result for the routine ref.
      const failureResult: InstructionResult = {
        raw: JSON.stringify({
          passed: false,
          flow: instruction.target,
          routines: inlinedRoutineIds,
          error: error instanceof Error ? error.message : String(error),
        }),
        parsed: {
          passed: false,
          summary: `Flow "${instruction.target}" failed`,
        },
      };

      const resultKey = instruction.output_as ?? instruction.id;
      return current.withResult(resultKey, failureResult);
    }

    eventBus.emit("feature-forge:routine-ref-done", {
      phase: "routine-ref-done",
      message: `Routine ref "${instruction.id}" → "${instruction.target}" complete`,
      details: {
        instructionId: instruction.id,
        target: instruction.target,
        flow: targetFlow.name,
        passed: allPassed,
      },
    });

    const result: InstructionResult = {
      raw: JSON.stringify({
        passed: allPassed,
        flow: instruction.target,
        routineCount: targetFlow.routines.length,
        routines: inlinedRoutineIds,
      }),
      parsed: {
        passed: allPassed,
        summary: allPassed
          ? `Flow "${instruction.target}" inlined ${routineCount} routine(s) — all passed`
          : `Flow "${instruction.target}" — some steps did not pass`,
      },
    };

    const resultKey = instruction.output_as ?? instruction.id;
    return current.withResult(resultKey, result);
  }

  getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase === "routine-ref-start") {
      return {
        type: "routine-ref",
        flow: event.details.flow,
        status: "started",
        phase: event.phase,
        message: event.message,
      };
    }
    if (event.phase === "routine-ref-done") {
      return {
        type: "routine-ref",
        flow: event.details.flow,
        status: "done",
        phase: event.phase,
        message: event.message,
      };
    }
    if (event.phase === "routine-ref-error") {
      return {
        type: "routine-ref",
        flow: event.details.flow,
        status: "error",
        phase: event.phase,
        message: event.message,
      };
    }
    return undefined;
  }

  registerDisplayHandler(registry: DisplayContributionRegistry): void {
    registry.register("routine-ref", (state, contribution) => {
      if (contribution.type !== "routine-ref") return;
      if (!state.routineRefs.includes(contribution.flow)) {
        state.routineRefs.push(contribution.flow);
      }
    });
  }
}

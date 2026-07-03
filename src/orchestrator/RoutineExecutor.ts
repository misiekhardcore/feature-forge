import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../logging";
import type { InstructionResult } from "./FlowContext";
import { FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineDefinition } from "./FlowInstruction";
import type { RoutineResult } from "./RoutineResult";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Runs one routine's steps to completion using a
 * {@link StepExecutorRegistry} to dispatch each instruction.
 *
 * State is threaded through an immutable {@link FlowContext} — no shared
 * mutable state between steps.
 *
 * Usage:
 * ```typescript
 * const executor = new RoutineExecutor(flow, stepRegistry);
 * const result = await executor.run("build", { branch: "fix/bug" }, "Fix #42");
 * ```
 */
export class RoutineExecutor {
  constructor(
    private readonly flow: FlowDefinition,
    private readonly stepRegistry: StepExecutorRegistry,
    public readonly eventBus: EventBus,
  ) {}

  /**
   * Execute every step in the named routine and return a structured result.
   *
   * @param routineName — Must exist in {@link flow.routines}.
   * @param params — Key-value pairs exposed as `{{PARAM}}` tokens.
   * @param task — Top-level task description, exposed as `{{prompt}}`.
   * @returns Structured result with per-instruction outputs.
   */
  async run(
    routineName: string,
    params: Record<string, string>,
    task: string,
  ): Promise<RoutineResult> {
    const routine: RoutineDefinition | undefined = this.flow.routines[routineName];
    if (!routine) {
      throw new Error(
        `Routine "${routineName}" not found in flow "${this.flow.name}". ` +
          `Available: ${Object.keys(this.flow.routines).join(", ")}`,
      );
    }

    logger.info("Starting routine", {
      flow: this.flow.name,
      routine: routineName,
      stepCount: routine.steps.length,
    });

    let context = new FlowContext(new Map(), task, new Map(), new Map(Object.entries(params)));

    // Recursive step dispatcher — passes itself to executors so container
    // instructions (loop, parallel) can dispatch their children without
    // depending on the StepExecutorRegistry directly.
    const executeStep = async (
      instruction: FlowInstruction,
      ctx: FlowContext,
    ): Promise<FlowContext> => {
      const executor = this.stepRegistry.get(instruction.type);
      if (!executor) {
        throw new Error(
          `No step executor registered for type "${instruction.type}" ` +
            `(routine "${routineName}", step "${instruction.id}")`,
        );
      }
      return executor.execute(instruction, ctx, executeStep, this.eventBus);
    };

    for (const step of routine.steps) {
      logger.debug("Executing step", {
        routine: routineName,
        step: step.id,
        type: step.type,
      });

      try {
        context = await executeStep(step, context);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Step execution failed", {
          routine: routineName,
          step: step.id,
          type: step.type,
          error: err,
        });
        return this.buildFailureResult(routineName, context, err);
      }
    }

    return this.buildResult(routineName, context, true);
  }

  private buildResult(
    routineName: string,
    context: FlowContext,
    passed: boolean,
    error?: Error,
  ): RoutineResult {
    const results: Record<string, InstructionResult> = {};
    for (const [key, value] of context.results) {
      results[key] = value;
    }

    // Backwards-compat: single-workspace flows expect `workspace` on the
    // top-level result. Multi-workspace flows should read workspace paths
    // from `results` directly.
    const workspaceEntry = [...context.workspaces.entries()][0];
    const workspace = workspaceEntry ? workspaceEntry[1].path : undefined;

    const summary = passed
      ? `Routine "${routineName}" completed with ${Object.keys(results).length} results`
      : `Routine "${routineName}" failed: ${error?.message ?? "unknown error"}`;

    return {
      routine: routineName,
      passed,
      rounds: context.iteration + 1,
      workspace,
      results,
      summary,
    };
  }

  private buildFailureResult(
    routineName: string,
    context: FlowContext,
    error: Error,
  ): RoutineResult {
    return this.buildResult(routineName, context, false, error);
  }
}

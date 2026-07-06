import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import { createChildExecutionContext } from "../execution-factory";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { MaxDepthExceededError } from "../MaxDepthExceededError";
import { RoutineExecutor } from "../RoutineExecutor";
import type { RuntimeCapabilities } from "../RuntimeCapabilities";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "routine" instruction by calling into another flow's
 * named routine with input params, collecting the result, and
 * storing it in the parent context.
 *
 * Uses {@link RuntimeCapabilities} to look up the target flow and
 * create a {@link RoutineExecutor} for the child call.
 *
 * The child execution runs in a fresh {@link FlowContext} with
 * incremented depth (see {@link createChildExecutionContext}).
 */
export class RoutineRefStepExecutor extends StepExecutor<RoutineRefInstruction> {
  readonly type = "routine";

  constructor(private readonly capabilities: RuntimeCapabilities) {
    super();
  }

  async execute(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    signal?.throwIfAborted();

    const targetFlow = this.capabilities.flows.get(instruction.target);
    if (!targetFlow) {
      const failureResult: InstructionResult = {
        raw: `Target flow "${instruction.target}" not found`,
        parsed: {
          kind: "build",
          passed: false,
          summary: `RoutineRef "${instruction.id}": target flow "${instruction.target}" not found in registry`,
        },
      };

      if (instruction.on_error === "continue") {
        return context.withResult(instruction.id, failureResult);
      }
      throw new Error(
        `Target flow "${instruction.target}" not found for routine ref "${instruction.id}"`,
      );
    }

    const routine = targetFlow.routines[instruction.routine];
    if (!routine) {
      const available = Object.keys(targetFlow.routines).join(", ");
      const failureResult: InstructionResult = {
        raw: `Routine "${instruction.routine}" not found in flow "${instruction.target}`,
        parsed: {
          kind: "build",
          passed: false,
          summary: `RoutineRef "${instruction.id}": routine "${instruction.routine}" not found. Available: ${available}`,
        },
      };

      if (instruction.on_error === "continue") {
        return context.withResult(instruction.id, failureResult);
      }
      throw new Error(
        `Routine "${instruction.routine}" not found in flow "${instruction.target}" ` +
          `for routine ref "${instruction.id}". Available: ${available}`,
      );
    }

    // Resolve input params through the parent context's template engine.
    const resolvedInput: Record<string, string> = {};
    for (const [key, value] of Object.entries(instruction.input)) {
      resolvedInput[key] = context.resolve(value);
    }

    logger.info("Executing cross-flow routine ref", {
      instructionId: instruction.id,
      target: instruction.target,
      routine: instruction.routine,
      input: resolvedInput,
    });

    eventBus.emit("feature-forge:routine-ref-start", {
      phase: "routine-ref-start",
      message: `RoutineRef "${instruction.id}": calling ${instruction.target} → ${instruction.routine}`,
      details: {},
    });

    // Validate depth nesting limit and compute the child depth before
    // proceeding (throws MaxDepthExceededError if the limit is exceeded).
    const childContext = createChildExecutionContext(context);

    // Build a RoutineExecutor for the target flow using our step executor registry.
    const childExecutor = new RoutineExecutor(
      targetFlow,
      this.capabilities.stepExecutorRegistry,
      this.capabilities.eventBus,
    );

    try {
      // Apply timeout if configured.
      const effectiveSignal = this.applyTimeout(signal, instruction.timeout);

      const result = await childExecutor.run(
        instruction.routine,
        resolvedInput,
        context.prompt,
        effectiveSignal,
        childContext.depth,
      );

      eventBus.emit("feature-forge:routine-ref-done", {
        phase: "routine-ref-done",
        message: `RoutineRef "${instruction.id}": ${instruction.target} → ${instruction.routine} completed`,
        details: {},
      });

      // Store the routine result under the instruction id (or output_as if specified).
      const outputId = instruction.output_as ?? instruction.id;
      const resultValue: InstructionResult = {
        raw: result.summary,
        parsed: {
          kind: "build",
          passed: result.passed,
          summary: `Cross-flow routine "${instruction.routine}" from "${instruction.target}" completed`,
        },
      };

      return context.withResult(outputId, resultValue);
    } catch (error) {
      // Handle AbortError from timeout or external cancellation.
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      // MaxDepthExceededError always propagates — it is a safety limit,
      // not a recoverable routine failure.
      if (error instanceof MaxDepthExceededError) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Cross-flow routine ref failed", {
        instructionId: instruction.id,
        target: instruction.target,
        routine: instruction.routine,
        error: err,
      });

      const failureResult: InstructionResult = {
        raw: err.message,
        parsed: {
          kind: "build",
          passed: false,
          summary: `RoutineRef "${instruction.id}" failed: ${err.message}`,
        },
      };

      if (instruction.on_error === "continue") {
        eventBus.emit("feature-forge:routine-ref-error", {
          phase: "routine-ref-error",
          message: `RoutineRef "${instruction.id}" failed (continuing): ${err.message}`,
          details: {},
        });
        return context.withResult(instruction.id, failureResult);
      }

      throw err;
    }
  }

  /**
   * Wrap the parent signal with a timeout-derived AbortController
   * when `timeout` is configured and greater than zero.
   */
  private applyTimeout(parentSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
    if (!timeoutMs || timeoutMs <= 0) return parentSignal;

    const controller = new AbortController();

    // Abort on timeout.
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Forward parent abort.
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
        clearTimeout(timer);
      } else {
        parentSignal.addEventListener(
          "abort",
          () => {
            controller.abort();
            clearTimeout(timer);
          },
          { once: true },
        );
      }
    }

    // Clean up timer when aborted.
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });

    return controller.signal;
  }
}

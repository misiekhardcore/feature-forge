import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  Theme,
  ToolDefinition,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { TObject, TProperties } from "typebox";
import { Type } from "typebox";

import { logger } from "../logging";
import type { RoutineDefinition } from "./FlowInstruction";
import { isLoopInstruction } from "./FlowInstruction";
import { NoOpProgressReporter } from "./progress/NoOpProgressReporter";
import type { ProgressEvent } from "./progress/ProgressEvent";
import { ProgressReporter } from "./progress/ProgressReporter";
import { TuiProgressReporter } from "./progress/TuiProgressReporter";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineProgressEvent } from "./RoutineProgress";

/**
 * Shared state type for {@link RoutineTool} renderer invalidation.
 *
 * The TUI assigns `context.invalidate` to this object so the progress
 * reporter's `onStateChange` callback can trigger tool-row re-renders.
 */
export interface RoutineToolRowState {
  invalidate: (() => void) | undefined;
}

/**
 * Tool adapter that wraps a single routine as a pi tool so the
 * orchestrator LLM can invoke it by name.
 *
 * Each routine gets its own {@link RoutineTool} instance, registered
 * at flow-load time.
 *
 * The tool's parameter schema is built dynamically from the routine's
 * declared `params` array so the LLM receives accurate parameter hints
 * with names and descriptions.
 *
 * Implements {@link ToolDefinition} directly rather than extending
 * the abstract {@link Tool} class, because the Tool base class
 * constrains TParams to extend TSchema, while we build a dynamic
 * schema that varies per routine.
 */
export class RoutineTool implements ToolDefinition<
  TObject<TProperties>,
  { routine: string; passed: boolean; summary: string },
  RoutineToolRowState
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TObject<TProperties>;

  private readonly routineName: string;

  constructor(
    flowName: string,
    routineName: string,
    private readonly executor: RoutineExecutor,
    private readonly routineDef: RoutineDefinition,
  ) {
    this.routineName = routineName;
    this.name = routineName;
    this.label = `Routine: ${flowName}/${routineName}`;
    this.description = this.buildDescription(routineName, routineDef);
    this.parameters = RoutineTool.buildParamsSchema(routineDef);
  }

  /** Shared state key for renderCall renderer invalidation. */
  readonly routineToolRowState: RoutineToolRowState = { invalidate: undefined };

  renderCall = (
    _args: Record<string, unknown>,
    theme: Theme,
    // ToolRenderContext is not publicly exported, so we type context loosely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: { state: RoutineToolRowState; invalidate: () => void; [key: string]: any },
  ): Component => {
    context.state.invalidate = context.invalidate;

    return {
      render: () => {
        return [theme.fg("accent", `⟳ ${this.routineName} · pending`)];
      },
      invalidate: () => {
        /* stateless — nothing to clear */
      },
    };
  };

  renderResult = (
    result: AgentToolResult<{ routine: string; passed: boolean; summary: string }>,
    _options: ToolRenderResultOptions,
    theme: Theme,
    _context: { state: RoutineToolRowState; invalidate: () => void },
  ): Component => {
    const passed = result.details?.passed ?? false;
    const routine = result.details?.routine ?? this.routineName;
    const icon = passed ? theme.fg("success", "✓") : theme.fg("error", "✗");

    return {
      render: () => {
        return [`${icon} ${routine} · ${passed ? "passed" : "failed"}`];
      },
      invalidate: () => {
        /* stateless — nothing to clear */
      },
    };
  };

  async execute(
    _toolCallId: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    onUpdate:
      | AgentToolUpdateCallback<{ routine: string; passed: boolean; summary: string }>
      | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<{ routine: string; passed: boolean; summary: string }>> {
    logger.info("RoutineTool invoked", {
      routine: this.routineName,
      params: Object.keys(params),
    });

    // `_prompt` is a collision-avoidance fallback: when a routine declares a
    // param also named "prompt", the LLM may pass the task under the underscore
    // alias. Both are accepted; the named param wins when present.
    const prompt = params["prompt"] ?? params["_prompt"] ?? "";
    const routineParams: Record<string, string> = {};
    for (const param of this.routineDef.params) {
      if (param.name in params) {
        routineParams[param.name] = params[param.name];
      }
    }

    // Extract loop config from the routine definition for progress reporting.
    const loopConfig = RoutineTool.findLoopConfig(this.routineDef);

    // Wire TUI progress reporter when UI is available.
    const reporter: ProgressReporter = ctx.ui
      ? new TuiProgressReporter({
          ctx,
          routineName: this.routineName,
          maxIterations: loopConfig.maxIterations,
          continueWhile: loopConfig.continueWhile,
          onStateChange: () => {
            this.routineToolRowState.invalidate?.();
          },
        })
      : new NoOpProgressReporter();

    const unsubscribe = this.executor.eventBus.on("feature-forge:*", (data: unknown) => {
      const event = data as RoutineProgressEvent;
      logger.debug("RoutineTool progress", { ...event });

      reporter.update(RoutineTool.toProgressEvent(event, this.routineName, loopConfig));

      if (onUpdate) {
        onUpdate({
          content: [
            {
              type: "text",
              text: `[${event.phase}] ${event.message}`,
            },
          ],
          details: {
            routine: event.details.routine ?? this.routineName,
            passed: event.details.passed ?? false,
            summary: event.message,
          },
        });
      }
    });

    try {
      const result = await this.executor.run(this.routineName, routineParams, prompt, signal);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: { routine: result.routine, passed: result.passed, summary: result.summary },
      };
    } catch (error) {
      // AbortError is a deliberate cancellation — report it before re-throwing.
      if (error instanceof DOMException && error.name === "AbortError") {
        logger.info("Routine aborted", { routine: this.routineName });
      }
      throw error;
    } finally {
      reporter.clear();
      unsubscribe();
    }
  }

  // ── Static helpers ────────────────────────────────────────

  private static findLoopConfig(routineDef: RoutineDefinition): {
    maxIterations: number;
    continueWhile?: string;
  } {
    for (const step of routineDef.steps) {
      if (isLoopInstruction(step)) {
        return {
          maxIterations: step.maxIterations,
          continueWhile: step.continueWhile,
        };
      }
    }
    return { maxIterations: 0 };
  }

  /**
   * Extract the instruction ID from an agent lifecycle event.
   *
   * Agent executors embed the instruction id in the message string using
   * the format `Agent "<id>" (...)`. This method parses that quoted
   * identifier rather than trying to extract it from the phase, since
   * phase strings are flat labels (")agent-started") without an identity suffix.
   *
   * @visibleForTesting
   */
  static extractAgentId(event: RoutineProgressEvent): string | undefined {
    const match = /Agent "([^"]+)"/.exec(event.message);
    return match ? match[1] : undefined;
  }

  private static toProgressEvent(
    event: RoutineProgressEvent,
    routineName: string,
    loopConfig: { maxIterations: number; continueWhile?: string },
  ): ProgressEvent {
    const isAgentPhase = event.phase.startsWith("agent-");
    const agentStatus =
      event.phase === "agent-started"
        ? "started"
        : event.phase === "agent-done"
          ? "done"
          : event.phase === "agent-error"
            ? "error"
            : undefined;

    return {
      routineName,
      phase: event.phase,
      message: event.message,
      iteration: event.details.rounds ? event.details.rounds - 1 : 0,
      maxIterations: loopConfig.maxIterations,
      agentId: isAgentPhase ? RoutineTool.extractAgentId(event) : undefined,
      agentStatus,
      agentSummary: isAgentPhase ? event.details.summary : undefined,
      workspace: event.details.workspace,
      continueWhile: loopConfig.continueWhile,
    };
  }

  private static buildParamsSchema(routineDef: RoutineDefinition): TObject<TProperties> {
    const properties: Record<string, ReturnType<typeof Type.String>> = {};
    for (const param of routineDef.params) {
      properties[param.name] = Type.String({
        description: param.description,
      });
    }
    return Type.Object(properties);
  }

  private buildDescription(routineName: string, routineDef: RoutineDefinition): string {
    if (routineDef.params.length === 0) {
      return `Run the "${routineName}" routine.`;
    }
    const paramList = routineDef.params.map((p) => p.name).join(", ");
    return `Run the "${routineName}" routine with params: ${paramList}.`;
  }
}

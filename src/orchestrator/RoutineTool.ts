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
import { ProgressRenderer } from "./progress/ProgressRenderer";
import type { ProgressWidget } from "./progress/ProgressReporter";
import type { RoutineProgressState } from "./progress/RoutineProgressState";
import { TuiRoutineWidget } from "./progress/TuiProgressReporter";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineProgressEvent } from "./RoutineProgress";
import type { RoutineResult } from "./RoutineResult";

const FEATURE_FORGE_CHANNELS = [
  "feature-forge:workspace-ready",
  "feature-forge:agent-started",
  "feature-forge:agent-done",
  "feature-forge:loop-round-start",
  "feature-forge:loop-round-complete",
  "feature-forge:parallel-start",
  "feature-forge:parallel-done",
  "feature-forge:cleanup-start",
  "feature-forge:cleanup-done",
  "feature-forge:git-start",
  "feature-forge:git-done",
  "feature-forge:shell-start",
  "feature-forge:shell-done",
];

/**
 * Internal state for tool-row invalidation.
 *
 * The TUI framework stores its `invalidate` callback here so that
 * progress-state changes can trigger tool-row re-renders.
 */
interface ToolRowInvalidation {
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
 * Implements {@link RoutineProgressState} so the {@link ProgressRenderer}
 * can read live state without coupling to the tool's internal structure.
 */
export class RoutineTool
  implements
    ToolDefinition<TObject<TProperties>, RoutineResult, ToolRowInvalidation>,
    RoutineProgressState
{
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TObject<TProperties>;

  /** Private backing fields — exposed through {@link RoutineProgressState} getters. */
  private readonly _routineName: string;
  private readonly _continueWhile?: string;

  /** Tracks agent state accumulated from display contributions. */
  private readonly _agentState = new Map<string, { status: string; summary?: string }>();

  /** Current iteration index (0-based), updated from loop events. */
  private _iteration = 0;
  /** Maximum loop iterations, updated from loop events. */
  private _maxIterations = 0;
  /** Current workspace path, updated from workspace events. */
  private _workspace?: string;

  /** Tool-row invalidation handle for renderCall/renderResult. */
  private readonly toolRowState: ToolRowInvalidation = { invalidate: undefined };

  /** Rendering delegate — builds TUI components and widget content from live state. */
  private readonly renderer: ProgressRenderer;

  constructor(
    flowName: string,
    routineName: string,
    private readonly executor: RoutineExecutor,
    private readonly routineDef: RoutineDefinition,
  ) {
    this._routineName = routineName;
    this.name = routineName;
    this.label = `Routine: ${flowName}/${routineName}`;
    this.description = this.buildDescription(routineName, routineDef);
    this.parameters = RoutineTool.buildParamsSchema(routineDef);

    // Extract continueWhile from the loop instruction, if present.
    for (const step of routineDef.steps) {
      if (isLoopInstruction(step) && step.continueWhile) {
        this._continueWhile = step.continueWhile;
        break;
      }
    }

    this.renderer = new ProgressRenderer(this);
  }

  // ── RoutineProgressState getters ───────────────────────────

  /** Routine name (e.g. "run_build_loop"). */
  get routineName(): string {
    return this._routineName;
  }

  /** Agents tracked during execution, keyed by instruction id. */
  get agentState(): ReadonlyMap<string, { status: string; summary?: string }> {
    return this._agentState;
  }

  /** Current loop iteration (0-based). */
  get iteration(): number {
    return this._iteration;
  }

  /** Maximum loop iterations. 0 when there is no loop. */
  get maxIterations(): number {
    return this._maxIterations;
  }

  /** Path to the current workspace, if one was created. */
  get workspace(): string | undefined {
    return this._workspace;
  }

  /** The `continueWhile` expression from the loop instruction, if any. */
  get continueWhile(): string | undefined {
    return this._continueWhile;
  }

  // ── ToolDefinition rendering ───────────────────────────────

  renderCall = (
    _args: Record<string, unknown>,
    theme: Theme,
    // ToolRenderContext is not publicly exported, so we type context loosely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: { state: ToolRowInvalidation; invalidate: () => void; [key: string]: any },
  ): Component => {
    context.state.invalidate = context.invalidate;
    this.toolRowState.invalidate = context.invalidate;
    return this.renderer.buildCallComponent(theme);
  };

  renderResult = (
    result: AgentToolResult<RoutineResult>,
    options: ToolRenderResultOptions,
    theme: Theme,
    _context: { state: ToolRowInvalidation; invalidate: () => void },
  ): Component => {
    return this.renderer.buildResultComponent(result, options, theme);
  };

  // ── Tool execution ─────────────────────────────────────────

  async execute(
    toolCallId: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<RoutineResult> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<RoutineResult>> {
    logger.info("RoutineTool invoked", {
      routine: this._routineName,
      params: Object.keys(params),
    });

    const prompt = params["prompt"] ?? params["_prompt"] ?? "";
    const routineParams: Record<string, string> = {};
    for (const param of this.routineDef.params) {
      if (param.name in params) {
        routineParams[param.name] = params[param.name];
      }
    }

    // Reset accumulated state for this execution.
    this.resetState();

    const widget: ProgressWidget = ctx.ui
      ? new TuiRoutineWidget({
          ctx,
          onStateChange: () => {
            this.toolRowState.invalidate?.();
          },
        })
      : new NoOpProgressReporter();

    const handler = (data: unknown): void => {
      const event = data as RoutineProgressEvent;
      logger.debug("RoutineTool progress", { ...event });

      // Accumulate display contributions from all executors.
      for (const executor of this.executor.stepRegistry.getAll().values()) {
        const contrib = executor.getDisplayContribution(event);
        if (!contrib) continue;

        if (contrib.agentId && contrib.agentStatus) {
          this._agentState.set(contrib.agentId, {
            status: contrib.agentStatus,
            summary: contrib.agentSummary,
          });
        }
        if (contrib.iteration !== undefined) {
          this._iteration = contrib.iteration;
        }
        if (contrib.maxIterations !== undefined) {
          this._maxIterations = contrib.maxIterations;
        }
        if (contrib.workspace !== undefined) {
          this._workspace = contrib.workspace;
        }
      }

      this.renderProgress(widget, ctx);

      if (onUpdate) {
        onUpdate({
          content: [
            {
              type: "text",
              text: `[${event.phase}] ${event.message}`,
            },
          ],
          details: {
            routine: event.details.routine ?? this._routineName,
            passed: event.details.passed ?? false,
            rounds: event.details.rounds ?? this._iteration + 1,
            workspace: event.details.workspace,
            results: {},
            summary: event.message,
          },
        });
      }
    };

    const unsubscribers = FEATURE_FORGE_CHANNELS.map((channel) =>
      this.executor.eventBus.on(channel, handler),
    );

    try {
      const result = await this.executor.run(this._routineName, routineParams, prompt, signal);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        logger.info("Routine aborted", { routine: this._routineName });
      }
      throw error;
    } finally {
      widget.clear();
      for (const unsub of unsubscribers) unsub();
    }
  }

  // ── Private helpers ────────────────────────────────────────

  /** Reset accumulated display state before each execution. */
  private resetState(): void {
    this._agentState.clear();
    this._iteration = 0;
    this._maxIterations = 0;
    this._workspace = undefined;
  }

  /** Build and render progress surfaces via the renderer. */
  private renderProgress(widget: ProgressWidget, ctx: ExtensionContext): void {
    const theme = ctx.ui?.theme ?? { fg: (_c: string, t: string) => t };
    this.renderer.renderToWidget(widget, theme);
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

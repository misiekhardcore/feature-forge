import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionContext,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { logger } from "@feature-forge/core";
import type { AgentSupervisor } from "@feature-forge/core/agents";
import type { RoutineDefinition } from "@feature-forge/core/flows";
import type { RoutineResult } from "@feature-forge/core/routines";
import { RoutineExecutor } from "@feature-forge/core/routines";
import type { TObject, TProperties } from "typebox";

import { AgentViewerLifecycle } from "../tui/AgentViewerLifecycle";
import type { AccumulatedState } from "../tui/progress/AccumulatedState";
import { createAccumulatedState } from "../tui/progress/AccumulatedState";
import { NoOpProgressReporter } from "../tui/progress/NoOpProgressReporter";
import { ProgressRenderer } from "../tui/progress/ProgressRenderer";
import type { ProgressWidget } from "../tui/progress/ProgressWidget";
import { RoutineProgressFeed } from "../tui/progress/RoutineProgressFeed";
import type { RoutineProgressState } from "../tui/progress/RoutineProgressState";
import { TuiRoutineWidget } from "../tui/progress/TuiRoutineWidget";
import { RoutineToolSchema } from "./RoutineToolSchema";

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
 * Minimal shape of the tool-row render context passed by the pi SDK.
 *
 * `ToolRenderContext` is not publicly exported, so the full context is
 * narrowed to the fields the renderers consume (state + invalidate).
 */
interface ToolRowRenderContext {
  state: ToolRowInvalidation;
  invalidate: () => void;
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

  /**
   * Progress feed for the current execution — owns subscriptions, the
   * {@link import("../tui/progress/DisplayProjection").applyEvent} fold, and the
   * accumulated state. Reassigned per execute() call; stays assigned after
   * completion so callers can read the final state.
   */
  private feed: RoutineProgressFeed | undefined;

  /** Empty state returned while no execution is in flight. */
  private readonly idleState: AccumulatedState = createAccumulatedState();

  /** Tool-row invalidation handle for renderCall/renderResult. */
  private readonly toolRowState: ToolRowInvalidation = { invalidate: undefined };

  /** Rendering delegate — builds TUI components and widget content from live state. */
  private readonly renderer: ProgressRenderer;

  constructor(
    flowName: string,
    private readonly routineDef: RoutineDefinition,
    private readonly executor: RoutineExecutor,
    private readonly supervisor: AgentSupervisor,
  ) {
    this._routineName = routineDef.id;
    this.name = routineDef.id;
    this.label = `Routine: ${flowName}/${routineDef.id}`;
    this.description = RoutineToolSchema.buildDescription(routineDef.id, routineDef);
    this.parameters = RoutineToolSchema.buildParamsSchema(routineDef);

    this.renderer = new ProgressRenderer(this);
  }

  // ── RoutineProgressState getters ───────────────────────────

  /** Routine name (e.g. "run_build_loop"). */
  get routineName(): string {
    return this._routineName;
  }

  /** Accumulated display state folded from the event stream. */
  get accumulatedState(): AccumulatedState {
    return this.feed?.accumulatedState ?? this.idleState;
  }

  // ── ToolDefinition rendering ───────────────────────────────

  renderCall = (
    _args: Record<string, unknown>,
    theme: Theme,
    context: ToolRowRenderContext,
  ): Component => {
    context.state.invalidate = context.invalidate;
    this.toolRowState.invalidate = context.invalidate;
    return this.renderer.buildCallComponent(theme);
  };

  renderResult = (
    result: AgentToolResult<RoutineResult>,
    options: ToolRenderResultOptions,
    theme: Theme,
    _context: ToolRowRenderContext,
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
      } else if (param.default !== undefined) {
        routineParams[param.name] = param.default;
      }
    }

    const widget: ProgressWidget = ctx.ui
      ? new TuiRoutineWidget({
          ctx,
          onStateChange: () => {
            this.toolRowState.invalidate?.();
          },
        })
      : new NoOpProgressReporter();

    // Agent viewer overlay — opened lazily on the first agent progress
    // event via the one-shot {@link AgentViewerLifecycle}, so routines
    // without agent steps never create an overlay.
    const viewer = new AgentViewerLifecycle({
      ctx,
      toolRegistry: this.executor.toolRegistry,
      eventBus: this.executor.eventBus,
      agentQuery: this.supervisor,
    });

    // Progress feed — owns subscriptions, the display-projection fold, and
    // the accumulated state. reset() runs inside subscribe(), so each
    // execution starts from a fresh fold.
    this.feed = new RoutineProgressFeed({
      routineName: this._routineName,
      eventBus: this.executor.eventBus,
      session: () => this.executor.store.toObject(),
      onUpdate,
      onAgentEvent: () => viewer.open(),
      onProgress: () => this.renderProgress(widget, ctx),
    });
    const unsubscribe = this.feed.subscribe();

    try {
      const result = await this.executor.run(
        this._routineName,
        routineParams,
        prompt,
        signal,
        this.routineDef,
      );

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
      unsubscribe();
      viewer.dispose();
    }
  }

  // ── Private helpers ────────────────────────────────────────

  /** Build and render progress surfaces via the renderer. */
  private renderProgress(widget: ProgressWidget, ctx: ExtensionContext): void {
    const theme = ctx.ui?.theme ?? { fg: (_c: string, t: string) => t };
    this.renderer.renderToWidget(widget, theme);
  }
}

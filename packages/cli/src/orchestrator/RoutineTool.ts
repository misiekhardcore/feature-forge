import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionContext,
  getMarkdownTheme,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { TObject, TProperties } from "typebox";
import { Type } from "typebox";

import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import { logger } from "../logging";
import { TypedEventBus } from "./eventBus";
import type { RoutineDefinition } from "./FlowInstruction";
import { AgentViewerOverlay, DisplayContributionRegistry } from "./progress";
import { createAccumulatedState } from "./progress/AccumulatedState";
import type { DisplayContribution } from "./progress/DisplayContribution";
import { NoOpProgressReporter } from "./progress/NoOpProgressReporter";
import { ProgressRenderer } from "./progress/ProgressRenderer";
import type { ProgressWidget } from "./progress/ProgressReporter";
import type { RoutineProgressState } from "./progress/RoutineProgressState";
import { SharedStreamDir } from "./progress/sharedStreamDir";
import { TuiRoutineWidget } from "./progress/TuiProgressReporter";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineProgressEvent } from "./RoutineProgress";
import type { RoutineResult } from "./RoutineResult";

/**
 * Channels the handler subscribes to for contribution accumulation and
 * progress widget rendering. Agent channels are included so the widget
 * shows agent lifecycle status — the overlay is driven separately via
 * {@link AgentViewerOverlay.wireOverlayEvents}.
 */
const PROGRESS_CHANNELS = [
  "feature-forge:workspace-ready",
  "feature-forge:agent-started",
  "feature-forge:agent-stream",
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
] as const;

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

  /** Accumulated display contributions from all step executors, in arrival order. */
  private readonly _contributions: DisplayContribution[] = [];

  /** Tool-row invalidation handle for renderCall/renderResult. */
  private readonly toolRowState: ToolRowInvalidation = { invalidate: undefined };

  /** Registry of display contribution handlers for accumulated state. */
  private readonly displayRegistry: DisplayContributionRegistry;

  /** Rendering delegate — builds TUI components and widget content from live state. */
  private readonly renderer: ProgressRenderer;

  constructor(
    flowName: string,
    routineName: string,
    private readonly executor: RoutineExecutor,
    private readonly routineDef: RoutineDefinition,
    private readonly supervisor: AgentSupervisor,
  ) {
    this._routineName = routineName;
    this.name = routineName;
    this.label = `Routine: ${flowName}/${routineName}`;
    this.description = this.buildDescription(routineName, routineDef);
    this.parameters = RoutineTool.buildParamsSchema(routineDef);

    // Wire the display contribution registry so ProgressRenderer can
    // build an accumulated snapshot via registry.apply() instead of
    // iterating contributions manually.
    this.displayRegistry = new DisplayContributionRegistry();
    for (const stepExecutor of this.executor.stepRegistry.getAll().values()) {
      stepExecutor.registerDisplayHandler(this.displayRegistry);
    }

    this.renderer = new ProgressRenderer(this, this.displayRegistry);
  }

  // ── RoutineProgressState getters ───────────────────────────

  /** Routine name (e.g. "run_build_loop"). */
  get routineName(): string {
    return this._routineName;
  }

  /** Accumulated display contributions from all step executors, in arrival order. */
  get contributions(): readonly DisplayContribution[] {
    return this._contributions;
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

    // Agent viewer overlay — shown via ctx.ui.custom, dismissed on routine completion.
    let viewerDismiss: (() => void) | undefined;
    let overlayCleanup: (() => void) | undefined;
    if (ctx.hasUI) {
      const streamDir = SharedStreamDir.get();
      const typedBus = new TypedEventBus(this.executor.eventBus);
      ctx.ui
        .custom<void>(
          (tui, theme, _kb, done) => {
            viewerDismiss = done;

            const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
              eventBus: typedBus,
              supervisor: this.supervisor,
            });

            const viewer = new AgentViewerOverlay({
              tui,
              theme,
              onDone: () => {
                unsubs.forEach((u) => u());
                viewer.dispose();
                done();
              },
              cwd: ctx.cwd,
              markdownTheme: getMarkdownTheme(),
            });

            connect(viewer, streamDir);

            overlayCleanup = () => {
              unsubs.forEach((u) => u());
              viewer.dispose();
            };

            return viewer;
          },
          {
            overlay: true,
            overlayOptions: AgentViewerOverlay.overlayOptions,
          },
        )
        .catch(() => {
          logger.warn("Agent viewer overlay creation failed");
        });
    }

    const handler = (data: unknown): void => {
      const event = data as RoutineProgressEvent;
      logger.debug("RoutineTool progress", { ...event });

      // Accumulate display contributions from all executors.
      // Stream-only events (agent-stream chunks with no state transition)
      // are high-frequency and carry no structural information — skip them
      // to avoid bloating the contributions array.
      for (const executor of this.executor.stepRegistry.getAll().values()) {
        const contrib = executor.getDisplayContribution(event);
        if (!contrib) continue;
        const isStreamOnly = contrib.type === "agent" && contrib.streamEvent !== undefined;
        if (!isStreamOnly) {
          this._contributions.push(contrib);
        }
      }

      this.renderProgress(widget, ctx);

      if (onUpdate) {
        const acc = createAccumulatedState();
        this.displayRegistry.apply(acc, this._contributions);
        const resultDetails = event.details as Partial<RoutineResult>;
        onUpdate({
          content: [
            {
              type: "text",
              text: `[${event.phase}] ${event.message}`,
            },
          ],
          details: {
            routine: resultDetails.routine ?? this._routineName,
            passed: resultDetails.passed ?? false,
            rounds: resultDetails.rounds ?? acc.iteration + 1,
            workspace: resultDetails.workspace,
            results: {},
            summary: event.message,
            session: this.executor.store.toObject(),
          },
        });
      }
    };

    const unsubscribers = PROGRESS_CHANNELS.map((channel) =>
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
      viewerDismiss?.();
      overlayCleanup?.();
      unsubscribers.forEach((u) => u());
    }
  }

  // ── Private helpers ────────────────────────────────────────

  /** Reset accumulated display state before each execution. */
  private resetState(): void {
    this._contributions.length = 0;
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

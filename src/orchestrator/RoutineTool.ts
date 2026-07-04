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
import {
  buildStatusLine,
  buildWidgetLines,
  formatAgentRow,
  statusIcon,
} from "./progress/ProgressRenderer";
import type { ProgressWidget } from "./progress/ProgressReporter";
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
 * Progress reporting extracts display contributions from each registered
 * {@link import("./StepExecutor").StepExecutor} via
 * {@link import("./StepExecutor").StepExecutor.getDisplayContribution}
 * and renders them through a {@link ProgressWidget} (TUI or no-op).
 */
export class RoutineTool implements ToolDefinition<
  TObject<TProperties>,
  RoutineResult,
  ToolRowInvalidation
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TObject<TProperties>;

  private readonly routineName: string;
  private readonly continueWhile?: string;

  /** Tracks agent state accumulated from display contributions. */
  private readonly agentState = new Map<string, { status: string; summary?: string }>();

  /** Current iteration index (0-based), updated from loop events. */
  private iteration = 0;
  /** Maximum loop iterations, updated from loop events. */
  private maxIterations = 0;
  /** Current workspace path, updated from workspace events. */
  private workspace?: string;

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

    // Extract continueWhile from the loop instruction, if present.
    for (const step of routineDef.steps) {
      if (isLoopInstruction(step) && step.continueWhile) {
        this.continueWhile = step.continueWhile;
        break;
      }
    }
  }

  /** Tool-row invalidation handle for renderCall/renderResult. */
  private readonly toolRowState: ToolRowInvalidation = { invalidate: undefined };

  renderCall = (
    _args: Record<string, unknown>,
    theme: Theme,
    // ToolRenderContext is not publicly exported, so we type context loosely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context: { state: ToolRowInvalidation; invalidate: () => void; [key: string]: any },
  ): Component => {
    context.state.invalidate = context.invalidate;
    // Sync the TUI invalidate to our private handle so execute() can trigger re-renders.
    this.toolRowState.invalidate = context.invalidate;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      render: () => {
        const parts = [theme.fg("accent", `⟳ ${self.routineName}`)];
        if (self.maxIterations > 0) {
          parts.push(theme.fg("muted", ` ${self.iteration + 1}/${self.maxIterations}`));
        }
        const agentCount = self.agentState.size;
        if (agentCount > 0) {
          parts.push(theme.fg("muted", ` · ${agentCount} agent${agentCount > 1 ? "s" : ""}`));
        } else {
          parts.push(theme.fg("muted", " · pending"));
        }
        return [parts.join("")];
      },
      invalidate: () => {
        /* stateless — re-render is handled by onStateChange */
      },
    };
  };

  renderResult = (
    result: AgentToolResult<RoutineResult>,
    _options: ToolRenderResultOptions,
    theme: Theme,
    _context: { state: ToolRowInvalidation; invalidate: () => void },
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
    toolCallId: string,
    params: Record<string, string>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<RoutineResult> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<RoutineResult>> {
    logger.info("RoutineTool invoked", {
      routine: this.routineName,
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
          this.agentState.set(contrib.agentId, {
            status: contrib.agentStatus,
            summary: contrib.agentSummary,
          });
        }
        if (contrib.iteration !== undefined) {
          this.iteration = contrib.iteration;
        }
        if (contrib.maxIterations !== undefined) {
          this.maxIterations = contrib.maxIterations;
        }
        if (contrib.workspace !== undefined) {
          this.workspace = contrib.workspace;
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
            routine: event.details.routine ?? this.routineName,
            passed: event.details.passed ?? false,
            rounds: event.details.rounds ?? this.iteration + 1,
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
      const result = await this.executor.run(this.routineName, routineParams, prompt, signal);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        logger.info("Routine aborted", { routine: this.routineName });
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
    this.agentState.clear();
    this.iteration = 0;
    this.maxIterations = 0;
    this.workspace = undefined;
  }

  /** Build and render progress surfaces from accumulated state. */
  private renderProgress(widget: ProgressWidget, ctx: ExtensionContext): void {
    const theme = ctx.ui?.theme ?? { fg: (_c: string, t: string) => t };

    // Format agent rows for the widget.
    const rows: string[] = [];
    for (const [label, agent] of this.agentState) {
      const icon = statusIcon(agent.status, theme);
      rows.push(formatAgentRow(icon, label, agent.summary));
    }

    // Widget subtitle and metadata.
    const subtitle =
      this.maxIterations > 0 ? `iteration ${this.iteration + 1}/${this.maxIterations}` : undefined;

    const metadata: string[] = [];
    if (this.continueWhile) {
      metadata.push(`while: ${this.continueWhile}`);
    }

    const widgetLines = buildWidgetLines({
      theme: theme,
      title: this.routineName,
      subtitle,
      rows,
      metadata: metadata.length > 0 ? metadata : undefined,
      path: this.workspace,
    });

    // Format agent tags for the status line.
    const tags: string[] = [];
    for (const [label, agent] of this.agentState) {
      const icon = statusIcon(agent.status, theme);
      tags.push(`${icon} ${label}`);
    }

    const statusText = buildStatusLine({
      theme: theme,
      title: this.routineName,
      subtitle: this.maxIterations > 0 ? `${this.iteration + 1}/${this.maxIterations}` : undefined,
      tags,
    });

    widget.render(widgetLines, statusText);
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

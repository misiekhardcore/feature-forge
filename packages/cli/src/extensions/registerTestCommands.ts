import * as path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ScenarioData } from "@feature-forge/debug";
import {
  builderScenario,
  conversationScenario,
  emptyScenario,
  errorScenario,
  manyTurnsScenario,
  registerTestLoopRoutine,
  reviewerScenario,
  toolArgsScenario,
} from "@feature-forge/debug";
import { ForgeConfig } from "@feature-forge/shared";
import {
  AgentViewerEntry,
  AgentViewerOverlay,
  ProgressRenderer,
  TuiRoutineWidget,
} from "@feature-forge/tui";

import { showAgentViewer } from "../agents";
import { withForgePrefix } from "../registry/CommandRegistry";
import { ToolRegistry } from "../registry/ToolRegistry";

// ── Guard ───────────────────────────────────────────────────

export function registerDevTestCommands(pi: ExtensionAPI, toolRegistry: ToolRegistry): void {
  if (!ForgeConfig.getInstance().getDevEnabled()) return;

  const DEFAULT_EVENT_DELAY = 200;

  function scheduleScenario(
    viewer: AgentViewerOverlay,
    scenario: ScenarioData,
    timers: ReturnType<typeof setTimeout>[],
    baseDelay = 0,
    eventDelay = DEFAULT_EVENT_DELAY,
  ): void {
    viewer.update({ id: scenario.agentId, status: "started", createdAt: new Date() });
    for (let i = 0; i < scenario.events.length; i++) {
      const delay = baseDelay + (i + 1) * eventDelay;
      const event = scenario.events[i];
      timers.push(setTimeout(() => viewer.pushStreamEvent(scenario.agentId, event), delay));
    }
    const finalDelay = baseDelay + (scenario.events.length + 1) * eventDelay;
    timers.push(
      setTimeout(
        () =>
          viewer.update({
            id: scenario.agentId,
            status: scenario.status as AgentViewerEntry["status"],
            summary: scenario.summary,
            passed: scenario.passed,
            createdAt: new Date(),
          } as AgentViewerEntry),
        finalDelay,
      ),
    );
  }

  /**
   * Schedule every scenario on the viewer. Multi-agent sets are staggered by
   * a 200 ms offset so the entries arrive in order.
   */
  function scheduleScenarios(
    viewer: AgentViewerOverlay,
    scenarios: ScenarioData[],
    timers: ReturnType<typeof setTimeout>[],
    eventDelay = DEFAULT_EVENT_DELAY,
  ): void {
    const offset = scenarios.length <= 1 ? 0 : 200;
    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[i];
      if (sc) scheduleScenario(viewer, sc, timers, i * offset, eventDelay);
    }
  }

  /**
   * Open the viewer with a set of self-driven scenarios through the shared
   * composer: `setup` schedules the scenario timers (and applies any stream
   * directory), `onDismiss` clears them so no timer fires against a disposed
   * overlay.
   */
  async function runScenarioViewer(
    ctx: ExtensionCommandContext,
    scenarios: ScenarioData[],
    options?: { streamDir?: string; eventDelay?: number },
  ): Promise<void> {
    const timers: ReturnType<typeof setTimeout>[] = [];
    await showAgentViewer({
      ctx,
      config: ForgeConfig.getInstance(),
      toolRegistry,
      setup: (viewer) => {
        if (options?.streamDir) viewer.setStreamDir(options.streamDir);
        scheduleScenarios(viewer, scenarios, timers, options?.eventDelay);
      },
      onDismiss: () => {
        timers.forEach(clearTimeout);
      },
    });
  }

  // ── Command registrations ─────────────────────────────────

  pi.registerCommand(withForgePrefix("test-viewer"), {
    description: "Open AgentViewerOverlay with 7 preset test scenarios as separate agents",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await runScenarioViewer(ctx, [
        emptyScenario(),
        builderScenario(),
        reviewerScenario(),
        errorScenario(),
        conversationScenario(),
        toolArgsScenario(),
        manyTurnsScenario(),
      ]);
    },
  });

  pi.registerCommand(withForgePrefix("test-scroll"), {
    description: "Open AgentViewerOverlay with a 35-turn conversation for auto-scroll testing",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await runScenarioViewer(ctx, [manyTurnsScenario()]);
    },
  });

  pi.registerCommand(withForgePrefix("test-tool-args"), {
    description:
      "Open AgentViewerOverlay with bash, read, and write tool calls showing visible args",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await runScenarioViewer(ctx, [toolArgsScenario()]);
    },
  });

  pi.registerCommand(withForgePrefix("test-stream-replay"), {
    description: "Open AgentViewerOverlay with events persisted to disk and replayed from JSONL",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      const streamDir = path.join(ctx.cwd, ".pi", "test-streams");
      await runScenarioViewer(ctx, [conversationScenario()], { streamDir, eventDelay: 0 });
    },
  });

  // ── Debug-package commands ────────────────────────────────

  registerTestLoopRoutine(
    pi,
    {
      createWidget: (ctx) => new TuiRoutineWidget({ ctx }),
      createOverlay: ({ tui, theme, onDone }) =>
        new AgentViewerOverlay({
          tui,
          theme,
          onDone,
          markdownTheme: getMarkdownTheme(),
          cwd: process.cwd(),
          toolRegistry,
          config: ForgeConfig.getInstance(),
        }),
      overlayOptions: AgentViewerOverlay.getOverlayOptions(),
      renderHelpers: {
        statusIcon: ProgressRenderer.statusIcon.bind(ProgressRenderer),
        formatAgentRow: ProgressRenderer.formatAgentRow.bind(ProgressRenderer),
        buildWidgetLines: ProgressRenderer.buildWidgetLines.bind(ProgressRenderer),
        buildStatusLine: ProgressRenderer.buildStatusLine.bind(ProgressRenderer),
      },
    },
    {
      builderScenario,
      reviewerScenario,
      errorScenario,
    },
  );
}

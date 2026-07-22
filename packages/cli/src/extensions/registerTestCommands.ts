import * as path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
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
import type { AgentViewerEntry } from "@feature-forge/tui";

import { ForgeConfig } from "../config";
import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { ProgressRenderer } from "../orchestrator/progress/ProgressRenderer";
import { TuiRoutineWidget } from "../orchestrator/progress/TuiProgressReporter";
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

  function createViewer(
    tui: TUI,
    theme: Theme,
    onDone: () => void,
    timers: ReturnType<typeof setTimeout>[],
    scenarios: ScenarioData[],
    toolRegistry: ToolRegistry,
    streamDir?: string,
    delay?: number,
  ): AgentViewerOverlay & Component {
    const resolvedDelay = delay ?? DEFAULT_EVENT_DELAY;
    const viewer = new AgentViewerOverlay({
      tui,
      theme,
      onDone: () => {
        timers.forEach(clearTimeout);
        viewer.dispose();
        onDone();
      },
      markdownTheme: getMarkdownTheme(),
      cwd: process.cwd(),
      toolRegistry,
    });
    if (streamDir) viewer.setStreamDir(streamDir);
    const offset = scenarios.length <= 1 ? 0 : 200;
    for (let i = 0; i < scenarios.length; i++) {
      const sc = scenarios[i];
      if (sc) scheduleScenario(viewer, sc, timers, i * offset, resolvedDelay);
    }
    return viewer;
  }

  // ── Command registrations ─────────────────────────────────

  pi.registerCommand("test-viewer", {
    description: "Open AgentViewerOverlay with 7 preset test scenarios as separate agents",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          return createViewer(
            tui,
            theme,
            () => done(undefined),
            timers,
            [
              emptyScenario(),
              builderScenario(),
              reviewerScenario(),
              errorScenario(),
              conversationScenario(),
              toolArgsScenario(),
              manyTurnsScenario(),
            ],
            toolRegistry,
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });

  pi.registerCommand("test-scroll", {
    description: "Open AgentViewerOverlay with a 35-turn conversation for auto-scroll testing",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          return createViewer(
            tui,
            theme,
            () => done(undefined),
            timers,
            [manyTurnsScenario()],
            toolRegistry,
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });

  pi.registerCommand("test-tool-args", {
    description:
      "Open AgentViewerOverlay with bash, read, and write tool calls showing visible args",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          return createViewer(
            tui,
            theme,
            () => done(undefined),
            timers,
            [toolArgsScenario()],
            toolRegistry,
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });

  pi.registerCommand("test-stream-replay", {
    description: "Open AgentViewerOverlay with events persisted to disk and replayed from JSONL",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          const streamDir = path.join(ctx.cwd, ".pi", "test-streams");
          return createViewer(
            tui,
            theme,
            () => done(undefined),
            timers,
            [conversationScenario()],
            toolRegistry,
            streamDir,
            0,
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
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
        }),
      overlayOptions: AgentViewerOverlay.overlayOptions,
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

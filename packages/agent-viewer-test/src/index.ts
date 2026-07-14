import * as path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { AgentViewerOverlay } from "@feature-forge/cli";

import type { ScenarioData } from "./scenarios/index.js";
import {
  builderScenario,
  conversationScenario,
  emptyScenario,
  errorScenario,
  manyTurnsScenario,
  reviewerScenario,
  toolArgsScenario,
} from "./scenarios/index.js";

// ── Helpers ─────────────────────────────────────────────────

const DEFAULT_EVENT_DELAY = 300; // ms between consecutive events

/**
 * Schedule a scenario's events on the given viewer with timed delays
 * so the user sees a realistic streaming effect.
 */
function scheduleScenario(
  viewer: AgentViewerOverlay,
  scenario: ScenarioData,
  timers: ReturnType<typeof setTimeout>[],
  baseDelay = 0,
  eventDelay = DEFAULT_EVENT_DELAY,
): void {
  viewer.update({ id: scenario.agentId, status: "started" });

  for (let i = 0; i < scenario.events.length; i++) {
    const delay = baseDelay + (i + 1) * eventDelay;
    const event = scenario.events[i];
    if (!event) continue;
    timers.push(
      setTimeout(() => {
        viewer.pushStreamEvent(scenario.agentId, event);
      }, delay),
    );
  }

  const finalDelay = baseDelay + (scenario.events.length + 1) * eventDelay;
  timers.push(
    setTimeout(() => {
      viewer.update({
        id: scenario.agentId,
        status: scenario.status,
        summary: scenario.summary,
        passed: scenario.passed,
      });
    }, finalDelay),
  );
}

/**
 * Create a pre-populated AgentViewerOverlay.
 */
function createViewer(
  tui: TUI,
  theme: Theme,
  onDone: () => void,
  cwd: string,
  timers: ReturnType<typeof setTimeout>[],
  scenarios: ScenarioData[],
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
    cwd,
    markdownTheme: getMarkdownTheme(),
  });

  if (streamDir) {
    viewer.setStreamDir(streamDir);
  }

  const offset = scenarios.length <= 1 ? 0 : 600;
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    if (sc) scheduleScenario(viewer, sc, timers, i * offset, resolvedDelay);
  }

  return viewer;
}

// ── Extension factory ───────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  // Guard: extension is dead code unless FEATURE_FORGE_DEV is set.
  if (!process.env.FEATURE_FORGE_DEV) return;

  pi.registerCommand("test-viewer", {
    description: "Open AgentViewerOverlay with 7 preset test scenarios as separate agents",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          return createViewer(tui, theme, () => done(undefined), ctx.cwd, timers, [
            emptyScenario(),
            builderScenario(),
            reviewerScenario(),
            errorScenario(),
            conversationScenario(),
            toolArgsScenario(),
            manyTurnsScenario(),
          ]);
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
          return createViewer(tui, theme, () => done(undefined), ctx.cwd, timers, [
            manyTurnsScenario(),
          ]);
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
          return createViewer(tui, theme, () => done(undefined), ctx.cwd, timers, [
            toolArgsScenario(),
          ]);
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
            ctx.cwd,
            timers,
            [conversationScenario()],
            streamDir,
            0, // push all events immediately, no delay
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });
}

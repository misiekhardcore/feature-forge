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
  reviewerScenario,
  toolArgsScenario,
} from "@feature-forge/debug";

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
    viewer.update({ id: scenario.agentId, status: "started" });
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
            status: scenario.status,
            summary: scenario.summary,
            passed: scenario.passed,
          }),
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

  pi.registerCommand("test-loop-routine", {
    description:
      "Simulate a 3-round build loop with builder, review, and verify agents to test widget/overlay alignment",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      const widget = new TuiRoutineWidget({
        ctx: ctx,
      });

      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          const viewer = new AgentViewerOverlay({
            tui,
            theme,
            onDone: () => {
              timers.forEach(clearTimeout);
              viewer.dispose();
              widget.clear();
              done(undefined);
            },
            markdownTheme: getMarkdownTheme(),
            cwd: process.cwd(),
            toolRegistry,
          });

          const ROUTINE = "test_loop_routine";
          const MAX_ROUNDS = 3;
          const EVENT_DELAY = 100;

          const agentDefs = [
            { id: "builder", label: "builder", scenario: builderScenario },
            { id: "review", label: "review", scenario: reviewerScenario },
            { id: "verify", label: "verify", scenario: errorScenario },
          ];

          function agentPassed(agentId: string, round: number): boolean {
            if (agentId === "builder") return true;
            if (agentId === "review") return round >= 2;
            return round >= 3;
          }

          interface AgentRoundState {
            status: string;
            summary?: string;
            passed?: boolean;
          }

          const agentStates = new Map<string, AgentRoundState>();

          function renderWidget(round: number): void {
            const rows: string[] = [];
            const tags: string[] = [];
            for (const def of agentDefs) {
              const state = agentStates.get(def.id);
              if (state) {
                const icon = ProgressRenderer.statusIcon(state.status, theme, state.passed);
                rows.push(ProgressRenderer.formatAgentRow(icon, def.label, state.summary));
                tags.push(`${icon} ${def.label}`);
              }
            }

            widget.render(
              ProgressRenderer.buildWidgetLines({
                theme,
                title: ROUTINE,
                subtitle: `iteration ${round}/${MAX_ROUNDS}`,
                rows,
              }),
              ProgressRenderer.buildStatusLine({
                theme,
                title: ROUTINE,
                subtitle: `${round}/${MAX_ROUNDS}`,
                tags,
              }),
            );
          }

          function scheduleAgent(
            agentId: string,
            scenario: ScenarioData,
            round: number,
            baseDelay: number,
            onStart: () => void,
            onDone: () => void,
          ): void {
            timers.push(
              setTimeout(() => {
                viewer.update({ id: agentId, status: "started" });
                agentStates.set(agentId, { status: "running" });
                onStart();
              }, baseDelay),
            );

            for (let i = 0; i < scenario.events.length; i++) {
              timers.push(
                setTimeout(
                  () => {
                    viewer.pushStreamEvent(agentId, scenario.events[i]);
                  },
                  baseDelay + (i + 1) * EVENT_DELAY,
                ),
              );
            }

            timers.push(
              setTimeout(
                () => {
                  const passed = agentPassed(agentId, round);
                  const status = passed ? "done" : "error";
                  viewer.update({
                    id: agentId,
                    status: status,
                    summary: scenario.summary,
                    passed,
                  });
                  agentStates.set(agentId, {
                    status,
                    summary: scenario.summary,
                    passed,
                  });
                  onDone();
                },
                baseDelay + (scenario.events.length + 1) * EVENT_DELAY,
              ),
            );
          }

          function simulateRound(round: number, baseDelay: number): void {
            const parallelDuration =
              Math.max(reviewerScenario().events.length, errorScenario().events.length) *
                EVENT_DELAY +
              EVENT_DELAY;

            // Builder runs first
            scheduleAgent(
              "builder",
              builderScenario(),
              round,
              baseDelay,
              () => renderWidget(round),
              () => renderWidget(round),
            );

            // Review + verify start in parallel after a staggered delay
            const parallelBase = baseDelay + 400;
            scheduleAgent(
              "review",
              reviewerScenario(),
              round,
              parallelBase,
              () => renderWidget(round),
              () => renderWidget(round),
            );
            scheduleAgent(
              "verify",
              errorScenario(),
              round,
              parallelBase + 100,
              () => renderWidget(round),
              () => renderWidget(round),
            );

            // After all agents complete, advance or finish
            const roundDuration = parallelBase + parallelDuration + 800;
            timers.push(
              setTimeout(() => {
                renderWidget(round);

                if (round < MAX_ROUNDS) {
                  for (const def of agentDefs) {
                    agentStates.set(def.id, { status: "pending" });
                  }
                  simulateRound(round + 1, roundDuration);
                } else {
                  timers.push(
                    setTimeout(() => {
                      widget.clear();
                      done(undefined);
                    }, 2000),
                  );
                }
              }, roundDuration),
            );
          }

          // Initial state
          for (const def of agentDefs) {
            agentStates.set(def.id, { status: "pending" });
          }
          renderWidget(1);
          simulateRound(1, 300);

          return viewer;
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });
}

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { ScenarioData } from "../scenarios/index.js";

// ── CLI dependency interfaces ───────────────────────────────

/** Theme-like coloring contract. */
export interface ThemeLike {
  fg(color: string, text: string): string;
}

/** Minimal AgentViewerOverlay surface needed by the simulator. */
export interface ViewerHandle {
  update(entry: { id: string; status: string; summary?: string; passed?: boolean }): void;
  pushStreamEvent(agentId: string, event: unknown): void;
  dispose(): void;
}

/** Minimal TuiRoutineWidget surface. */
export interface WidgetHandle {
  render(widgetLines: string[], statusText: string): void;
  clear(): void;
}

/** Static rendering helpers matching ProgressRenderer. */
export interface RenderHelpers {
  statusIcon(status: string | undefined, theme: ThemeLike, passed?: boolean): string;
  formatAgentRow(icon: string, label: string, annotation?: string): string;
  buildWidgetLines(params: {
    theme: ThemeLike;
    title: string;
    subtitle?: string;
    rows: string[];
    path?: string;
  }): string[];
  buildStatusLine(params: {
    theme: ThemeLike;
    title: string;
    subtitle?: string;
    tags: string[];
  }): string;
}

/** Dependencies provided by the CLI package. */
export interface TestLoopDeps {
  createWidget: (ctx: ExtensionCommandContext) => WidgetHandle;
  createOverlay: (params: {
    tui: TUI;
    theme: Theme;
    onDone: () => void;
  }) => ViewerHandle & Component;
  overlayOptions: Record<string, unknown>;
  renderHelpers: RenderHelpers;
}

/** Scenarios used by the loop simulation. */
export interface TestLoopScenarios {
  builderScenario: () => ScenarioData;
  reviewerScenario: () => ScenarioData;
  errorScenario: () => ScenarioData;
}

// ── Simulation constants ────────────────────────────────────

const ROUTINE = "test_loop_routine";
const MAX_ROUNDS = 3;
const EVENT_DELAY = 100;

interface AgentRoundState {
  status: string;
  summary?: string;
  passed?: boolean;
}

// ── Command registration ────────────────────────────────────

export function registerTestLoopRoutine(
  pi: ExtensionAPI,
  deps: TestLoopDeps,
  scenarios: TestLoopScenarios,
): void {
  pi.registerCommand("test-loop-routine", {
    description:
      "Simulate a 3-round build loop with builder, review, and verify agents to test widget/overlay alignment",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;

      const widget = deps.createWidget(ctx);

      await ctx.ui.custom<void>(
        (tui: TUI, theme: Theme, _kb, done: (result: void) => void) => {
          const timers: ReturnType<typeof setTimeout>[] = [];
          const viewer = deps.createOverlay({
            tui,
            theme,
            onDone: () => {
              timers.forEach(clearTimeout);
              viewer.dispose();
              widget.clear();
              done(undefined);
            },
          });

          const agentDefs = [
            { id: "builder", label: "builder", scenario: scenarios.builderScenario },
            { id: "review", label: "review", scenario: scenarios.reviewerScenario },
            { id: "verify", label: "verify", scenario: scenarios.errorScenario },
          ];

          function agentPassed(agentId: string, round: number): boolean {
            if (agentId === "builder") return true;
            if (agentId === "review") return round >= 2;
            return round >= 3;
          }

          const agentStates = new Map<string, AgentRoundState>();
          const rh = deps.renderHelpers;

          function renderWidget(round: number): void {
            const rows: string[] = [];
            const tags: string[] = [];
            for (const def of agentDefs) {
              const state = agentStates.get(def.id);
              if (state) {
                const icon = rh.statusIcon(state.status, theme, state.passed);
                rows.push(rh.formatAgentRow(icon, def.label, state.summary));
                tags.push(`${icon} ${def.label}`);
              }
            }

            widget.render(
              rh.buildWidgetLines({
                theme,
                title: ROUTINE,
                subtitle: `iteration ${round}/${MAX_ROUNDS}`,
                rows,
              }),
              rh.buildStatusLine({
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
                    status,
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
              Math.max(
                scenarios.reviewerScenario().events.length,
                scenarios.errorScenario().events.length,
              ) *
                EVENT_DELAY +
              EVENT_DELAY;

            scheduleAgent(
              "builder",
              scenarios.builderScenario(),
              round,
              baseDelay,
              () => renderWidget(round),
              () => renderWidget(round),
            );

            const parallelBase = baseDelay + 400;
            scheduleAgent(
              "review",
              scenarios.reviewerScenario(),
              round,
              parallelBase,
              () => renderWidget(round),
              () => renderWidget(round),
            );
            scheduleAgent(
              "verify",
              scenarios.errorScenario(),
              round,
              parallelBase + 100,
              () => renderWidget(round),
              () => renderWidget(round),
            );

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

          for (const def of agentDefs) {
            agentStates.set(def.id, { status: "pending" });
          }
          renderWidget(1);
          simulateRound(1, 300);

          return viewer;
        },
        { overlay: true, overlayOptions: deps.overlayOptions },
      );
    },
  });
}

import * as path from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai/base";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";

import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";

// ── Message helpers ─────────────────────────────────────────

function textBlock(text: string): TextContent {
  return { type: "text", text };
}

function assistantMsg(text: string, toolCalls?: ToolCall[]): AssistantMessage {
  const content: AssistantMessage["content"] = [textBlock(text)];
  if (toolCalls) content.push(...toolCalls);
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function toolResultMsg(
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [textBlock(content)],
    isError,
    timestamp: Date.now(),
  };
}

// ── Event helpers ───────────────────────────────────────────

function agentStartEvent(): AgentEvent {
  return { type: "agent_start" };
}
function agentEndEvent(): AgentEvent {
  return { type: "agent_end", messages: [] };
}
function turnStartEvent(): AgentEvent {
  return { type: "turn_start" };
}
function turnEndEvent(message: AssistantMessage, toolResults: ToolResultMessage[]): AgentEvent {
  return { type: "turn_end", message, toolResults };
}
function messageStartEvent(message: AssistantMessage): AgentEvent {
  return { type: "message_start", message };
}
function messageUpdateEvent(
  message: AssistantMessage,
  assistantMessageEvent: AssistantMessageEvent,
): AgentEvent {
  return { type: "message_update", message, assistantMessageEvent };
}
function messageEndEvent(message: AssistantMessage): AgentEvent {
  return { type: "message_end", message };
}
function toolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}
function toolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: string,
  isError: boolean,
): AgentEvent {
  return { type: "tool_execution_end", toolCallId, toolName, result, isError };
}
function textDeltaEvent(
  contentIndex: number,
  delta: string,
  partial: AssistantMessage,
): AssistantMessageEvent {
  return { type: "text_delta", contentIndex, delta, partial };
}

// ── Scenario factories ──────────────────────────────────────

interface ScenarioData {
  agentId: string;
  events: AgentEvent[];
  status: string;
  summary?: string;
  passed?: boolean;
}

function emptyScenario(): ScenarioData {
  return {
    agentId: "empty",
    events: [agentStartEvent(), agentEndEvent()],
    status: "done",
    summary: "Empty agent — no events recorded",
    passed: true,
  };
}

function builderScenario(): ScenarioData {
  return {
    agentId: "builder",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      toolExecutionStartEvent("call-b-1", "read", { path: "forge.config.ts" }),
      toolExecutionEndEvent(
        "call-b-1",
        "read",
        'export default { project: "feature-forge" }',
        false,
      ),
      toolExecutionStartEvent("call-b-2", "write", { path: "output.ts" }),
      toolExecutionEndEvent("call-b-2", "write", "Written 1 file", false),
      turnEndEvent(assistantMsg("Build complete."), [
        toolResultMsg("call-b-1", "read", "config loaded"),
        toolResultMsg("call-b-2", "write", "file written"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Builder completed — 2 files processed",
    passed: true,
  };
}

function reviewerScenario(): ScenarioData {
  return {
    agentId: "reviewer",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      toolExecutionStartEvent("call-r-1", "bash", { command: "npx eslint src/" }),
      toolExecutionEndEvent("call-r-1", "bash", "3 errors, 5 warnings found in src/", false),
      turnEndEvent(assistantMsg("Found lint issues."), [
        toolResultMsg("call-r-1", "bash", "3 errors, 5 warnings"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Review — 3 errors, 5 warnings",
    passed: false,
  };
}

function errorScenario(): ScenarioData {
  return {
    agentId: "crash-agent",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      toolExecutionStartEvent("call-e-1", "bash", { command: "crash-simulator" }),
      toolExecutionEndEvent("call-e-1", "bash", "Command failed with exit code 137", true),
      turnEndEvent(assistantMsg("Agent crashed."), [
        toolResultMsg("call-e-1", "bash", "OOM killed", true),
      ]),
      agentEndEvent(),
    ],
    status: "error",
    summary: "Agent crashed — OOM",
  };
}

function conversationScenario(): ScenarioData {
  const initial = assistantMsg("Let me check the codebase.");
  const updated = assistantMsg("Let me check the codebase for relevant patterns.");
  return {
    agentId: "researcher",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      messageStartEvent(initial),
      messageUpdateEvent(updated, textDeltaEvent(0, " for relevant patterns", updated)),
      messageEndEvent(updated),
      toolExecutionStartEvent("call-c-1", "grep", { pattern: "registerHandler" }),
      toolExecutionEndEvent("call-c-1", "grep", "Found in 3 files", false),
      turnEndEvent(updated, [toolResultMsg("call-c-1", "grep", "3 files matched")]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Researcher — found patterns in 3 files",
    passed: true,
  };
}

function manyTurnsScenario(): ScenarioData {
  const events: AgentEvent[] = [agentStartEvent()];
  for (let i = 0; i < 35; i++) {
    events.push(turnStartEvent());
    events.push(
      toolExecutionStartEvent(`call-mt-${i}`, "bash", {
        command: `echo "Iteration ${i + 1} of 35"`,
      }),
    );
    events.push(
      toolExecutionEndEvent(`call-mt-${i}`, "bash", `Iteration ${i + 1} complete`, false),
    );
    events.push(
      turnEndEvent(assistantMsg(`Completed iteration ${i + 1}.`), [
        toolResultMsg(`call-mt-${i}`, "bash", "ok"),
      ]),
    );
  }
  events.push(agentEndEvent());
  return {
    agentId: "scroll-test",
    events,
    status: "done",
    summary: "35-turn scroll test",
    passed: true,
  };
}

function toolArgsScenario(): ScenarioData {
  return {
    agentId: "tool-args-demo",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      toolExecutionStartEvent("call-ta-1", "bash", {
        command: "find . -type f -name '*.ts' | xargs wc -l | sort -rn | head -20",
      }),
      toolExecutionEndEvent("call-ta-1", "bash", "Found 8472 lines in 156 files", false),
      toolExecutionStartEvent("call-ta-2", "read", {
        path: "src/AgentViewerOverlay.ts",
        offset: 0,
        limit: 100,
      }),
      toolExecutionEndEvent("call-ta-2", "read", "file content...", false),
      toolExecutionStartEvent("call-ta-3", "write", {
        path: "output/report.md",
        content: "# Build Report\n\nAll passed.\n",
      }),
      toolExecutionEndEvent("call-ta-3", "write", "Written 1 file", false),
      turnEndEvent(assistantMsg("3 tool calls shown."), [
        toolResultMsg("call-ta-1", "bash", "ok"),
        toolResultMsg("call-ta-2", "read", "ok"),
        toolResultMsg("call-ta-3", "write", "ok"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "3 distinct tool calls with visible args",
    passed: true,
  };
}

// ── Scheduling ──────────────────────────────────────────────

const DEFAULT_EVENT_DELAY = 300;

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
  if (streamDir) viewer.setStreamDir(streamDir);
  const offset = scenarios.length <= 1 ? 0 : 600;
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    if (sc) scheduleScenario(viewer, sc, timers, i * offset, resolvedDelay);
  }
  return viewer;
}

// ── Command registration ────────────────────────────────────

export function registerDevTestCommands(pi: ExtensionAPI): void {
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
            0,
          );
        },
        { overlay: true, overlayOptions: AgentViewerOverlay.overlayOptions },
      );
    },
  });
}

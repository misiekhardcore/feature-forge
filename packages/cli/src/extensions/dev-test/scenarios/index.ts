import type { AgentEvent } from "@earendil-works/pi-agent-core";

import {
  agentEndEvent,
  agentStartEvent,
  messageEndEvent,
  messageStartEvent,
  messageUpdateEvent,
  textDeltaEvent,
  toolExecutionEndEvent,
  toolExecutionStartEvent,
  turnEndEvent,
  turnStartEvent,
} from "../helpers/events.js";
import { assistantMsg, toolResultMsg } from "../helpers/messages.js";

export interface ScenarioData {
  agentId: string;
  events: AgentEvent[];
  status: string;
  summary?: string;
  passed?: boolean;
}

export function emptyScenario(): ScenarioData {
  return {
    agentId: "empty",
    events: [agentStartEvent(), agentEndEvent()],
    status: "done",
    summary: "Empty agent — no events recorded",
    passed: true,
  };
}

export function builderScenario(): ScenarioData {
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

export function reviewerScenario(): ScenarioData {
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

export function errorScenario(): ScenarioData {
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

export function conversationScenario(): ScenarioData {
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

export function manyTurnsScenario(): ScenarioData {
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

export function toolArgsScenario(): ScenarioData {
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

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

// ── Scenario data type ──────────────────────────────────────

export interface ScenarioData {
  /** Agent identifier (matches the overlay entry id). */
  agentId: string;
  /** Stream events to push in order. */
  events: AgentEvent[];
  /** Final lifecycle status to set on the viewer entry. */
  status: string;
  /** Optional one-line summary. */
  summary?: string;
  /** Whether the agent's outcome passed. */
  passed?: boolean;
}

// ── Scenario factories ──────────────────────────────────────

/**
 * Empty agent — no events recorded.
 * Tests that the overlay displays "No conversation recorded" for agents with
 * no stream history.
 */
export function emptyScenario(): ScenarioData {
  return {
    agentId: "empty",
    events: [agentStartEvent(), agentEndEvent()],
    status: "done",
    summary: "Empty agent — no events recorded",
    passed: true,
  };
}

/**
 * Builder agent — reads a config file then writes output.
 * Tests basic tool call rendering (read + write) with visible arguments.
 */
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
    summary: "Builder completed successfully — 2 files processed",
    passed: true,
  };
}

/**
 * Reviewer agent — runs lint and finds issues.
 * Tests agent with a non-passing outcome (error count displayed).
 */
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
    summary: "Review failed — 3 errors, 5 warnings",
    passed: false,
  };
}

/**
 * Crash agent — tool exits with OOM (exit code 137).
 * Tests error tool call rendering (isError: true, red highlight).
 */
export function errorScenario(): ScenarioData {
  return {
    agentId: "crash-agent",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      toolExecutionStartEvent("call-e-1", "bash", { command: "crash-simulator" }),
      toolExecutionEndEvent("call-e-1", "bash", "Command failed with exit code 137", true),
      turnEndEvent(assistantMsg("Agent encountered a fatal error."), [
        toolResultMsg("call-e-1", "bash", "OOM killed", true),
      ]),
      agentEndEvent(),
    ],
    status: "error",
    summary: "Agent crashed — out of memory",
  };
}

/**
 * Researcher agent — streams conversation messages then runs a grep tool.
 * Tests live streaming (message_start → message_update → message_end)
 * interleaved with tool execution.
 */
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
    summary: "Researcher completed — found patterns in 3 files",
    passed: true,
  };
}

/**
 * 35-turn conversation for scroll testing.
 * Generates enough events to verify auto-scroll sticky-to-bottom and
 * pause-on-scrollup in the detail view.
 */
export function manyTurnsScenario(): ScenarioData {
  const events: AgentEvent[] = [agentStartEvent()];

  for (let i = 0; i < 35; i++) {
    events.push(turnStartEvent());
    events.push(
      toolExecutionStartEvent(`call-mt-${i}`, "bash", {
        command: `echo "Processing iteration ${i + 1} of 35"`,
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
    summary: "35-turn conversation for scroll testing",
    passed: true,
  };
}

/**
 * Tool-args demo — three distinct tool types with visible arguments.
 * Tests that bash commands, file paths, and file content are rendered
 * in the overlay list/detail views.
 */
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
        path: "src/orchestrator/progress/AgentViewerOverlay.ts",
        offset: 0,
        limit: 100,
      }),
      toolExecutionEndEvent("call-ta-2", "read", "file content...", false),
      toolExecutionStartEvent("call-ta-3", "write", {
        path: "output/report.md",
        content: "# Build Report\n\n## Summary\nAll tests passed.\n",
      }),
      toolExecutionEndEvent("call-ta-3", "write", "Written 1 file", false),
      turnEndEvent(assistantMsg("Demonstrated 3 distinct tool calls."), [
        toolResultMsg("call-ta-1", "bash", "ok"),
        toolResultMsg("call-ta-2", "read", "ok"),
        toolResultMsg("call-ta-3", "write", "ok"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "3 distinct tools with visible arguments",
    passed: true,
  };
}

import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai/base";

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
import { assistantMsg, toolCall, toolResultMsg, userMsg } from "../helpers/messages.js";

export interface ScenarioData {
  agentId: string;
  events: AgentEvent[];
  status: string;
  summary?: string;
  passed?: boolean;
}

/**
 * Emit pi's per-tool result pair: each tool result is finalised as its own
 * message_start/message_end pair (mirrors pi's {@code emitToolResultMessage}).
 */
function toolResultMessageEvents(result: ToolResultMessage): AgentEvent[] {
  return [messageStartEvent(result), messageEndEvent(result)];
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
  const prompt = userMsg("Check the forge config and write an output file based on it.");
  const readCall = toolCall("call-b-1", "read", { path: "forge.config.ts" });
  const writeCall = toolCall("call-b-2", "write", { path: "output.ts" });
  const assistant = assistantMsg("Build complete.", [readCall, writeCall]);
  return {
    agentId: "builder",
    events: [
      agentStartEvent(),
      messageStartEvent(prompt),
      messageEndEvent(prompt),
      turnStartEvent(),
      messageStartEvent({ ...assistant, content: [] } as AgentMessage),
      messageEndEvent(assistant),
      toolExecutionStartEvent(readCall.id, readCall.name, readCall.arguments),
      toolExecutionEndEvent(
        readCall.id,
        readCall.name,
        'export default { project: "feature-forge" }',
        false,
      ),
      ...toolResultMessageEvents(toolResultMsg(readCall.id, readCall.name, "config loaded")),
      toolExecutionStartEvent(writeCall.id, writeCall.name, writeCall.arguments),
      toolExecutionEndEvent(writeCall.id, writeCall.name, "Written 1 file", false),
      ...toolResultMessageEvents(toolResultMsg(writeCall.id, writeCall.name, "file written")),
      turnEndEvent(assistant, [
        toolResultMsg(readCall.id, readCall.name, "config loaded"),
        toolResultMsg(writeCall.id, writeCall.name, "file written"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Builder completed — 2 files processed",
    passed: true,
  };
}

export function reviewerScenario(): ScenarioData {
  const prompt = userMsg("Run the linter and report any issues found.");
  const bashCall = toolCall("call-r-1", "bash", { command: "npx eslint src/" });
  const assistant = assistantMsg("Found lint issues.", [bashCall]);
  return {
    agentId: "reviewer",
    events: [
      agentStartEvent(),
      messageStartEvent(prompt),
      messageEndEvent(prompt),
      turnStartEvent(),
      messageStartEvent({ ...assistant, content: [] } as AgentMessage),
      messageEndEvent(assistant),
      toolExecutionStartEvent(bashCall.id, bashCall.name, bashCall.arguments),
      toolExecutionEndEvent(
        bashCall.id,
        bashCall.name,
        "3 errors, 5 warnings found in src/",
        false,
      ),
      ...toolResultMessageEvents(toolResultMsg(bashCall.id, bashCall.name, "3 errors, 5 warnings")),
      turnEndEvent(assistant, [toolResultMsg(bashCall.id, bashCall.name, "3 errors, 5 warnings")]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Review — 3 errors, 5 warnings",
    passed: false,
  };
}

export function errorScenario(): ScenarioData {
  const bashCall = toolCall("call-e-1", "bash", { command: "crash-simulator" });
  const assistant = assistantMsg("Agent crashed.", [bashCall]);
  return {
    agentId: "crash-agent",
    events: [
      agentStartEvent(),
      turnStartEvent(),
      messageStartEvent({ ...assistant, content: [] } as AgentMessage),
      messageEndEvent(assistant),
      toolExecutionStartEvent(bashCall.id, bashCall.name, bashCall.arguments),
      toolExecutionEndEvent(bashCall.id, bashCall.name, "Command failed with exit code 137", true),
      ...toolResultMessageEvents(toolResultMsg(bashCall.id, bashCall.name, "OOM killed", true)),
      turnEndEvent(assistant, [toolResultMsg(bashCall.id, bashCall.name, "OOM killed", true)]),
      agentEndEvent(),
    ],
    status: "error",
    summary: "Agent crashed — OOM",
  };
}

export function conversationScenario(): ScenarioData {
  const prompt = userMsg(
    "Find all registerHandler calls in the codebase and summarize the patterns.",
  );
  const grepCall = toolCall("call-c-1", "grep", { pattern: "registerHandler" });
  const initial = assistantMsg("Let me check the codebase.", [grepCall]);
  const updated = assistantMsg("Let me check the codebase for relevant patterns.", [grepCall]);
  return {
    agentId: "researcher",
    events: [
      agentStartEvent(),
      messageStartEvent(prompt),
      messageEndEvent(prompt),
      turnStartEvent(),
      messageStartEvent({ ...initial, content: [] } as AgentMessage),
      messageUpdateEvent(updated, textDeltaEvent(0, " for relevant patterns", updated)),
      messageEndEvent(updated),
      toolExecutionStartEvent(grepCall.id, grepCall.name, grepCall.arguments),
      toolExecutionEndEvent(grepCall.id, grepCall.name, "Found in 3 files", false),
      ...toolResultMessageEvents(toolResultMsg(grepCall.id, grepCall.name, "3 files matched")),
      turnEndEvent(updated, [toolResultMsg(grepCall.id, grepCall.name, "3 files matched")]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "Researcher — found patterns in 3 files",
    passed: true,
  };
}

export function toolArgsScenario(): ScenarioData {
  const prompt = userMsg(
    "Run these three tools: count TypeScript lines, read the overlay source, and write a build report.",
  );
  const bashCall = toolCall("call-ta-1", "bash", {
    command: "find . -type f -name '*.ts' | xargs wc -l | sort -rn | head -20",
  });
  const readCall = toolCall("call-ta-2", "read", {
    path: "src/AgentViewerOverlay.ts",
    offset: 0,
    limit: 100,
  });
  const writeCall = toolCall("call-ta-3", "write", {
    path: "output/report.md",
    content: "# Build Report\n\nAll passed.\n",
  });
  const assistant = assistantMsg("3 tool calls shown.", [bashCall, readCall, writeCall]);
  return {
    agentId: "tool-args-demo",
    events: [
      agentStartEvent(),
      messageStartEvent(prompt),
      messageEndEvent(prompt),
      turnStartEvent(),
      messageStartEvent({ ...assistant, content: [] } as AgentMessage),
      messageEndEvent(assistant),
      toolExecutionStartEvent(bashCall.id, bashCall.name, bashCall.arguments),
      toolExecutionEndEvent(bashCall.id, bashCall.name, "Found 8472 lines in 156 files", false),
      ...toolResultMessageEvents(toolResultMsg(bashCall.id, bashCall.name, "ok")),
      toolExecutionStartEvent(readCall.id, readCall.name, readCall.arguments),
      toolExecutionEndEvent(readCall.id, readCall.name, "file content...", false),
      ...toolResultMessageEvents(toolResultMsg(readCall.id, readCall.name, "ok")),
      toolExecutionStartEvent(writeCall.id, writeCall.name, writeCall.arguments),
      toolExecutionEndEvent(writeCall.id, writeCall.name, "Written 1 file", false),
      ...toolResultMessageEvents(toolResultMsg(writeCall.id, writeCall.name, "ok")),
      turnEndEvent(assistant, [
        toolResultMsg(bashCall.id, bashCall.name, "ok"),
        toolResultMsg(readCall.id, readCall.name, "ok"),
        toolResultMsg(writeCall.id, writeCall.name, "ok"),
      ]),
      agentEndEvent(),
    ],
    status: "done",
    summary: "3 distinct tool calls with visible args",
    passed: true,
  };
}

export function manyTurnsScenario(): ScenarioData {
  const prompt = userMsg(
    "Run a 35-turn suite of mixed tool calls, streaming messages, and reports.",
  );
  const events: AgentEvent[] = [
    agentStartEvent(),
    messageStartEvent(prompt),
    messageEndEvent(prompt),
  ];

  for (let i = 0; i < 35; i++) {
    events.push(turnStartEvent());

    const turnType = i % 4;
    if (turnType === 0) {
      // bash tool call
      const bashCall = toolCall(`call-mt-${i}`, "bash", {
        command: `find src -name '*.ts' | head -${i + 5}`,
      });
      const assistant = assistantMsg(`Bash turn ${i + 1} done.`, [bashCall]);
      events.push(messageStartEvent({ ...assistant, content: [] } as AgentMessage));
      events.push(messageEndEvent(assistant));
      events.push(toolExecutionStartEvent(bashCall.id, bashCall.name, bashCall.arguments));
      events.push(
        toolExecutionEndEvent(bashCall.id, bashCall.name, `Found ${i + 5} TypeScript files`, false),
      );
      events.push(...toolResultMessageEvents(toolResultMsg(bashCall.id, bashCall.name, "ok")));
      events.push(turnEndEvent(assistant, [toolResultMsg(bashCall.id, bashCall.name, "ok")]));
    } else if (turnType === 1) {
      // read tool call
      const readCall = toolCall(`call-mt-${i}`, "read", {
        path: `src/config-${i}.ts`,
        offset: 0,
        limit: 50,
      });
      const assistant = assistantMsg(`Read turn ${i + 1} done.`, [readCall]);
      events.push(messageStartEvent({ ...assistant, content: [] } as AgentMessage));
      events.push(messageEndEvent(assistant));
      events.push(toolExecutionStartEvent(readCall.id, readCall.name, readCall.arguments));
      events.push(
        toolExecutionEndEvent(
          readCall.id,
          readCall.name,
          `Read ${i + 10} lines from config`,
          false,
        ),
      );
      events.push(...toolResultMessageEvents(toolResultMsg(readCall.id, readCall.name, "ok")));
      events.push(turnEndEvent(assistant, [toolResultMsg(readCall.id, readCall.name, "ok")]));
    } else if (turnType === 2) {
      // streaming assistant message (no tools)
      const msg = assistantMsg(
        `Analysis shows steady progress across all monitored dimensions. ` +
          `Throughput improved and latency reduced compared to previous runs. ` +
          `Overall stability remains high with no critical issues detected.`,
      );
      const deltaMsg = assistantMsg(
        `Analysis shows steady progress across all monitored dimensions. ` +
          `Throughput improved and latency reduced compared to previous runs. ` +
          `Overall stability remains high with no critical issues detected. ` +
          `Additional validation confirms all edge cases are handled correctly.`,
      );
      events.push(messageStartEvent(msg));
      events.push(
        messageUpdateEvent(
          deltaMsg,
          textDeltaEvent(
            0,
            " Additional validation confirms all edge cases are handled correctly.",
            deltaMsg,
          ),
        ),
      );
      events.push(messageEndEvent(deltaMsg));
      events.push(turnEndEvent(deltaMsg, []));
    } else {
      // dual bash + grep tool calls in one turn
      const bashCall = toolCall(`call-mt-${i}-a`, "bash", {
        command: `echo "Processing step ${i + 1}"`,
      });
      const grepCall = toolCall(`call-mt-${i}-b`, "grep", {
        pattern: "registerHandler",
        path: `src/step-${i}.ts`,
      });
      const assistant = assistantMsg(`Dual tool turn ${i + 1} done.`, [bashCall, grepCall]);
      events.push(messageStartEvent({ ...assistant, content: [] } as AgentMessage));
      events.push(messageEndEvent(assistant));
      events.push(toolExecutionStartEvent(bashCall.id, bashCall.name, bashCall.arguments));
      events.push(toolExecutionEndEvent(bashCall.id, bashCall.name, `Step ${i + 1} output`, false));
      events.push(...toolResultMessageEvents(toolResultMsg(bashCall.id, bashCall.name, "ok")));
      events.push(toolExecutionStartEvent(grepCall.id, grepCall.name, grepCall.arguments));
      events.push(
        toolExecutionEndEvent(
          grepCall.id,
          grepCall.name,
          `Found 3 matches in src/step-${i}.ts`,
          false,
        ),
      );
      events.push(
        ...toolResultMessageEvents(toolResultMsg(grepCall.id, grepCall.name, "3 matches")),
      );
      events.push(
        turnEndEvent(assistant, [
          toolResultMsg(bashCall.id, bashCall.name, "ok"),
          toolResultMsg(grepCall.id, grepCall.name, "3 matches"),
        ]),
      );
    }
  }
  events.push(agentEndEvent());
  return {
    agentId: "scroll-test",
    events,
    status: "done",
    summary: "35-turn scroll test with mixed tool calls, streaming messages, and reports",
    passed: true,
  };
}

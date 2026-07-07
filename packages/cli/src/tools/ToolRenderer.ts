import type {
  AgentToolResult,
  Theme,
  ThemeColor,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

import type { SendTaskParams, SpawnAgentParams } from "../ipc/messages";

type BgColor =
  | "selectedBg"
  | "userMessageBg"
  | "customMessageBg"
  | "toolPendingBg"
  | "toolSuccessBg"
  | "toolErrorBg";

/** Background colors assigned per tool. */
const BG: Record<string, BgColor> = {
  spawn_agent: "toolPendingBg",
  send_task: "toolSuccessBg",
  get_agent_result: "customMessageBg",
  list_agents: "selectedBg",
  destroy_agent: "toolErrorBg",
};

function header(theme: Theme, color: ThemeColor, text: string): string {
  return theme.fg(color, theme.bold(text));
}

interface ShellState {
  _box?: Box;
}

function shellBox(context: { state: ShellState }, theme: Theme, toolName: string): Box {
  const bgColor = BG[toolName] ?? "toolPendingBg";
  const state = context.state;
  let box = state._box;
  if (!box) {
    box = new Box(0, 1);
    state._box = box;
  }
  box.setBgFn((text: string) => theme.bg(bgColor, text));
  box.clear();
  return box;
}

/** Render a generic tool result: checkmark or error in muted text. */
function resultText(result: AgentToolResult<unknown>, theme: Theme): string {
  if (result.details && typeof result.details === "object" && "error" in result.details) {
    return theme.fg("error", `✗ ${String(result.details.error)}`);
  }
  return theme.fg("muted", "✓ done");
}

/** Shared renderCall and renderResult factories for tool TUI display. */
export class ToolRenderer {
  static MAX_TASK_SNIPPET_LENGTH = 100;
  // ── spawn_agent ──────────────────────────────────────────────

  static spawnAgentCall = (
    args: SpawnAgentParams,
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) => {
    const box = shellBox(context, theme, "spawn_agent");
    let content = header(theme, "success", `spawn_agent ${args.role}`);
    if (args.model) {
      content += " " + theme.fg("muted", `(${args.model})`);
    }
    box.addChild(new Text(content, 1, 0));
    return box;
  };

  static spawnAgentResult = (
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    theme: Theme,
    _context: { state: { _box?: Box } },
  ) => {
    if (options.isPartial) return new Text("", 1, 0);
    const text = resultText(result, theme);
    return new Text(text, 1, 0);
  };

  // ── send_task ─────────────────────────────────────────────────

  static sendTaskCall = (
    args: SendTaskParams,
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) => {
    const box = shellBox(context, theme, "send_task");
    const snippet =
      args.prompt.length > ToolRenderer.MAX_TASK_SNIPPET_LENGTH
        ? args.prompt.substring(0, ToolRenderer.MAX_TASK_SNIPPET_LENGTH - 3) + "..."
        : args.prompt;
    let content = header(theme, "accent", `send_task ${args.agentId}`);
    content += " " + theme.fg("muted", `"${snippet}"`);
    box.addChild(new Text(content, 1, 0));
    return box;
  };

  static sendTaskResult = ToolRenderer.spawnAgentResult;

  // ── get_agent_result ──────────────────────────────────────────

  static getAgentResultCall = (
    args: { agentId: string },
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) => {
    const box = shellBox(context, theme, "get_agent_result");
    box.addChild(new Text(header(theme, "warning", `get_agent_result ${args.agentId}`), 1, 0));
    return box;
  };

  static getAgentResultResult = ToolRenderer.spawnAgentResult;

  // ── destroy_agent ─────────────────────────────────────────────

  static destroyAgentCall = (
    args: { agentId: string },
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) => {
    const box = shellBox(context, theme, "destroy_agent");
    box.addChild(new Text(header(theme, "error", `destroy_agent ${args.agentId}`), 1, 0));
    return box;
  };

  static destroyAgentResult = ToolRenderer.spawnAgentResult;

  // ── list_agents ───────────────────────────────────────────────

  static listAgentsCall = (
    _args: unknown,
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) => {
    const box = shellBox(context, theme, "list_agents");
    box.addChild(new Text(header(theme, "text", "list_agents"), 1, 0));
    return box;
  };

  static listAgentsResult = ToolRenderer.spawnAgentResult;
}

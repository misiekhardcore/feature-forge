import type {
  AgentToolResult,
  Theme,
  ThemeColor,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { SendTaskParams, SpawnAgentParams } from "@feature-forge/cli/src/ipc/messages";

/** Background colours assigned per tool — derived from pi's Theme.bg parameter type. */
type ToolBgColor = Parameters<Theme["bg"]>[0];

const BG: Record<string, ToolBgColor> = {
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

/** Builder API passed to renderers inside {@link ToolRenderer.build}. */
interface Builder {
  /** Add a single line that auto-truncates to viewport width when collapsed. */
  line: (text: string) => void;
  /** Add expandable multi-line content. Collapsed → single TruncatedText; expanded → multiple Text lines. */
  expandable: (text: string | undefined, style?: ThemeColor) => void;
}

/** Shared renderCall and renderResult factories for tool TUI display. */
export class ToolRenderer {
  /**
   * Construct a render Box with auto-truncation and expand/collapse built in.
   *
   * This is the **only** entry point for tool renderers — every `renderCall`
   * and `renderResult` must pass through here.  The builder's {@link Builder.line}
   * and {@link Builder.expandable} methods automatically wrap content in
   * {@link TruncatedText} when the context is collapsed, so individual renderers
   * never need to worry about terminal width.
   */
  private static build(
    context: { state: Record<string, unknown>; expanded?: boolean },
    theme: Theme,
    toolName: string,
    fn: (b: Builder) => void,
  ): Box {
    const box = shellBox(context, theme, toolName);
    const expanded = context.expanded ?? false;

    const builder: Builder = {
      line: (text: string) => {
        box.addChild(expanded ? new Text(text, 1, 0) : new TruncatedText(text, 1, 0));
      },
      expandable: (text: string | undefined, style?: ThemeColor) => {
        if (!text) return;
        if (expanded) {
          for (const l of text.split("\n")) {
            box.addChild(new Text(style ? theme.fg(style, l) : l, 1, 0));
          }
        } else {
          const styled = style ? theme.fg(style, text) : text;
          box.addChild(new TruncatedText(styled, 1, 0));
        }
      },
    };

    fn(builder);
    return box;
  }

  // ── spawn_agent ──────────────────────────────────────────────

  static spawnAgentCall = (
    args: SpawnAgentParams,
    theme: Theme,
    context: { state: Record<string, unknown>; expanded?: boolean },
  ) =>
    ToolRenderer.build(context, theme, "spawn_agent", ({ line, expandable }) => {
      let content = header(theme, "success", `spawn_agent ${args.role}`);
      if (args.model) {
        content += " " + theme.fg("muted", `(${args.model})`);
      }
      line(content);
      expandable(args.systemPrompt, "muted");
    });

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
    context: { state: Record<string, unknown>; expanded: boolean },
  ) =>
    ToolRenderer.build(context, theme, "send_task", ({ line, expandable }) => {
      if (context.expanded) {
        line(header(theme, "accent", `send_task ${args.agentId}`));
        expandable(args.prompt, "muted");
      } else {
        const full =
          header(theme, "accent", `send_task ${args.agentId}`) +
          " " +
          theme.fg("muted", `"${args.prompt}"`);
        line(full);
      }
    });

  static sendTaskResult = ToolRenderer.spawnAgentResult;

  // ── get_agent_result ──────────────────────────────────────────

  static getAgentResultCall = (
    args: { agentId: string },
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) =>
    ToolRenderer.build(context, theme, "get_agent_result", ({ line }) => {
      line(header(theme, "warning", `get_agent_result ${args.agentId}`));
    });

  static getAgentResultResult = ToolRenderer.spawnAgentResult;

  // ── destroy_agent ─────────────────────────────────────────────

  static destroyAgentCall = (
    args: { agentId: string },
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) =>
    ToolRenderer.build(context, theme, "destroy_agent", ({ line }) => {
      line(header(theme, "error", `destroy_agent ${args.agentId}`));
    });

  static destroyAgentResult = ToolRenderer.spawnAgentResult;

  // ── list_agents ───────────────────────────────────────────────

  static listAgentsCall = (
    _args: unknown,
    theme: Theme,
    context: { state: Record<string, unknown> },
  ) =>
    ToolRenderer.build(context, theme, "list_agents", ({ line }) => {
      line(header(theme, "text", "list_agents"));
    });

  static listAgentsResult = ToolRenderer.spawnAgentResult;
}

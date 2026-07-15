import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";

import { AgentDisplayHelpers } from "./AgentDisplayHelpers";

/**
 * Renders a flat list of {@link AgentEvent} objects into styled conversation
 * lines using pi's built-in components.
 *
 * Groups related start/end events (message_start → message_end,
 * tool_execution_start → tool_execution_end) into visual blocks. Pending
 * state (in-progress messages / tool calls without a matching end event)
 * is flushed at the end of the stream.
 *
 * Each {@link render} call is stateless — the class holds only its
 * injected dependencies (theme, markdownTheme, tui, cwd) and produces
 * output purely from the given event list.
 */
export class ConversationRenderer {
  private readonly theme: Theme;
  private readonly markdownTheme: MarkdownTheme;
  private readonly tui: TUI;
  private readonly cwd: string;

  constructor(theme: Theme, markdownTheme: MarkdownTheme, tui: TUI, cwd: string) {
    this.theme = theme;
    this.markdownTheme = markdownTheme;
    this.tui = tui;
    this.cwd = cwd;
  }

  /**
   * Render a list of raw stream events as styled conversation lines.
   *
   * Dispatches on {@code AgentEvent.type} covering all 10 variants
   * in a discriminated switch. Messages are rendered via
   * {@link UserMessageComponent} (role "user"),
   * {@link AssistantMessageComponent} (role "assistant"), or plain text
   * extraction (all other roles). Tool calls are rendered via
   * {@link ToolExecutionComponent}.
   *
   * @param events — Stream events in insertion order.
   * @param width — Available render width in characters.
   * @returns Styled lines ready for display (no border added).
   */
  render(events: AgentEvent[], width: number): string[] {
    const lines: string[] = [];
    let toolCallIndex = 0;

    // In-progress state — local to this render call.
    let pendingMessage: AgentMessage | undefined;
    let pendingToolStart: Extract<AgentEvent, { type: "tool_execution_start" }> | undefined;
    let pendingToolResult: { text: string; isError: boolean } | undefined;

    const flushMessage = (): void => {
      if (!pendingMessage) return;

      if (pendingMessage.role === "user") {
        const text = AgentDisplayHelpers.extractMessageText(pendingMessage);
        if (text.length > 0) {
          const rendered = new UserMessageComponent(text, this.markdownTheme).render(width);
          for (const line of rendered) lines.push(line);
        }
      } else if (pendingMessage.role === "assistant") {
        const rendered = new AssistantMessageComponent(
          pendingMessage,
          false,
          this.markdownTheme,
        ).render(width);
        for (const line of rendered) lines.push(line);
      } else {
        // Custom, system, toolResult, and other roles — extract text.
        const text = AgentDisplayHelpers.extractMessageText(pendingMessage);
        if (text.length > 0) {
          lines.push(this.theme.fg("muted", text));
        }
      }
      pendingMessage = undefined;
    };

    const flushTool = (): void => {
      if (!pendingToolStart) return;
      toolCallIndex++;
      const component = new ToolExecutionComponent(
        pendingToolStart.toolName,
        `tool-${toolCallIndex}`,
        pendingToolStart.args,
        undefined,
        undefined,
        this.tui,
        this.cwd,
      );
      if (pendingToolResult) {
        component.updateResult(
          {
            content: [{ type: "text", text: pendingToolResult.text }],
            isError: pendingToolResult.isError,
          },
          false,
        );
        component.setExpanded(true);
      }
      const rendered = component.render(width);
      for (const line of rendered) lines.push(line);
      pendingToolStart = undefined;
      pendingToolResult = undefined;
    };

    for (const event of events) {
      switch (event.type) {
        case "message_start":
          flushTool();
          pendingMessage = event.message;
          break;

        case "message_update":
          if (pendingMessage) pendingMessage = event.message;
          break;

        case "message_end":
          if (pendingMessage) pendingMessage = event.message;
          flushMessage();
          break;

        case "tool_execution_start":
          flushMessage();
          pendingToolStart = event;
          pendingToolResult = undefined;
          break;

        case "tool_execution_update":
          if (pendingToolStart) {
            pendingToolResult = {
              text:
                (pendingToolResult?.text ?? "") +
                AgentDisplayHelpers.serializeToolResultText(event.partialResult),
              isError: false,
            };
          }
          break;

        case "tool_execution_end":
          pendingToolResult = {
            text: AgentDisplayHelpers.serializeToolResultText(event.result),
            isError: event.isError,
          };
          flushTool();
          break;

        case "turn_start":
        case "turn_end":
        case "agent_start":
        case "agent_end":
          // Lifecycle events are reflected in the agent list view.
          break;
      }
    }

    // Flush any remaining pending state (incomplete start without end).
    flushMessage();
    flushTool();

    return lines;
  }
}

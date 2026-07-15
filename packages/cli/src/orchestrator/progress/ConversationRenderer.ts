import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, type MarkdownTheme, Spacer, type TUI } from "@earendil-works/pi-tui";

/**
 * Type guard to verify if a part is a text block.
 */
function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as Record<string, unknown>).type === "text" &&
    "text" in part &&
    typeof (part as Record<string, unknown>).text === "string"
  );
}

/**
 * Extracts text content from various content formats used in messages and tool results.
 */
function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter(isTextPart)
      .map((part) => part.text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

/**
 * Extracts the text content from an AgentMessage.
 */
function extractUserText(message: AgentMessage): string {
  if ("content" in message) {
    return extractText((message as { content: unknown }).content);
  }
  return "";
}

/**
 * Converts a tool execution result into a displayable string.
 * Handles AgentToolResult shapes (objects with a content array) as well as primitives.
 */
function extractResultText(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;

  if (typeof result === "object" && result !== null && "content" in result) {
    const content = (result as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      const text = extractText(content);
      if (text) return text;
    }
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return "Unserializable tool result";
  }
}

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
   * Renders a user message and adds it to the container.
   */
  private renderUserMessage(message: AgentMessage, container: Container): void {
    const text = extractUserText(message);
    if (text.length === 0) return;

    if (container.children.length > 0) {
      container.addChild(new Spacer(1));
    }
    container.addChild(new UserMessageComponent(text, this.markdownTheme));
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
    const container = new Container();
    const pendingTools = new Map<string, ToolExecutionComponent>();
    let lastAssistant: AssistantMessageComponent | undefined;

    for (const event of events) {
      switch (event.type) {
        case "message_start": {
          if (!event.message) break;
          if (event.message.role === "assistant") {
            const component = new AssistantMessageComponent(undefined, false, this.markdownTheme);
            container.addChild(component);
            lastAssistant = component;
          } else {
            // Reset lastAssistant so subsequent updates don't target the previous assistant message
            lastAssistant = undefined;
          }
          break;
        }

        case "message_update": {
          if (event.message && event.message.role === "assistant") {
            lastAssistant?.updateContent(event.message);
          }
          break;
        }

        case "message_end": {
          if (!event.message) break;
          if (event.message.role === "assistant") {
            if (lastAssistant) {
              lastAssistant.updateContent(event.message);
            }
          } else {
            this.renderUserMessage(event.message, container);
          }
          break;
        }

        case "tool_execution_start": {
          const component = new ToolExecutionComponent(
            event.toolName,
            event.toolCallId,
            event.args,
            undefined,
            undefined,
            this.tui,
            this.cwd,
          );
          component.markExecutionStarted();
          container.addChild(component);
          pendingTools.set(event.toolCallId, component);
          break;
        }

        case "tool_execution_update": {
          const component = pendingTools.get(event.toolCallId);
          if (component) {
            component.updateResult(
              {
                content: [{ type: "text", text: extractResultText(event.partialResult) }],
                isError: false,
              },
              true,
            );
          }
          break;
        }

        case "tool_execution_end": {
          const component = pendingTools.get(event.toolCallId);
          if (component) {
            component.updateResult(
              {
                content: [{ type: "text", text: extractResultText(event.result) }],
                isError: event.isError,
              },
              false,
            );
            component.setExpanded(true);
          }
          break;
        }

        case "turn_start":
        case "turn_end":
        case "agent_start":
        case "agent_end":
          // Lifecycle events are reflected in the agent list view.
          break;
      }
    }

    return container.render(width);
  }
}

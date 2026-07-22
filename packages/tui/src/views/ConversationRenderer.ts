import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  AssistantMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, type MarkdownTheme, Spacer, type TUI } from "@earendil-works/pi-tui";
import { jsonParse } from "@feature-forge/shared";

import type { ToolFormatter } from "../api";
import { AgentDisplayHelpers } from "../display/AgentDisplayHelpers";

/**
 * Parameters for constructing a {@link ConversationRenderer}.
 */
export interface ConversationRendererParams {
  /** Theme for colouring UI elements. */
  theme: Theme;
  /** Markdown theme for rendering markdown content. */
  markdownTheme: MarkdownTheme;
  /** TUI instance for requesting re-renders. */
  tui: TUI;
  /** Current working directory — passed to tool execution components. */
  cwd: string;
  /** Registry for resolving tool definitions to restore argument formatting. */
  toolRegistry: ToolFormatter;
}

/**
 * Renders an array of {@link AgentMessage} objects into styled conversation
 * lines using pi's built-in components.
 *
 * Messages are dispatched by their `role` field matching pi's rendering
 * logic:
 * - "user" messages → {@link UserMessageComponent}
 * - "assistant" messages → {@link AssistantMessageComponent} with
 *   additional per-toolCall {@link ToolExecutionComponent} instances
 *   appended to the container
 * - "toolResult" messages match against pending tool execution
 *   components by {@code toolCallId} and call {@code updateResult}
 *   to display results inline
 *
 * Each {@link render} call is stateless — the class holds only its
 * injected dependencies (theme, markdownTheme, tui, cwd, toolRegistry) and produces output
 * purely from the given message list.
 */
export class ConversationRenderer {
  private readonly theme: Theme;
  private readonly markdownTheme: MarkdownTheme;
  private readonly tui: TUI;
  private readonly cwd: string;
  private readonly toolRegistry: ToolFormatter;

  constructor(params: ConversationRendererParams) {
    this.theme = params.theme;
    this.markdownTheme = params.markdownTheme;
    this.tui = params.tui;
    this.cwd = params.cwd;
    this.toolRegistry = params.toolRegistry;
  }

  /**
   * Renders a user message and adds it to the container.
   */
  private renderUserMessage(message: AgentMessage, container: Container): void {
    const text = AgentDisplayHelpers.extractMessageText(message);
    if (text.length === 0) return;

    if (container.children.length > 0) {
      container.addChild(new Spacer(1));
    }
    container.addChild(new UserMessageComponent(text, this.markdownTheme));
  }

  /**
   * Render a list of {@link AgentMessage} objects as styled conversation lines.
   *
   * Dispatches on `message.role` matching pi's rendering logic:
   * - "user" → {@link UserMessageComponent}
   * - "assistant" → {@link AssistantMessageComponent} plus individual
   *   {@link ToolExecutionComponent} instances for each toolCall content block
   * - "toolResult" → matched against pending tool execution components by
   *   {@code toolCallId}; updates the component with the result payload
   *
   * @param messages — Agent messages in chronological order.
   * @param width — Available render width in characters.
   * @returns Styled lines ready for display (no border added).
   */
  render(messages: AgentMessage[], width: number): string[] {
    const container = new Container();
    const pendingTools = new Map<string, ToolExecutionComponent>();

    for (const message of messages) {
      if (message.role === "user") {
        this.renderUserMessage(message, container);
      } else if (message.role === "assistant") {
        // Skip assistant messages without content — the underlying component
        // requires at least an empty content array.
        if (!message.content || (Array.isArray(message.content) && message.content.length === 0)) {
          continue;
        }
        const component = new AssistantMessageComponent(message, false, this.markdownTheme);

        if (container.children.length > 0) {
          // Add a spacer only when the previous child is not already an assistant
          // message (assistant blocks already have internal spacing).
          const lastChild = container.children[container.children.length - 1];
          if (!(lastChild instanceof AssistantMessageComponent)) {
            container.addChild(new Spacer(1));
          }
        }
        container.addChild(component);

        // Extract toolCall blocks from the assistant message content and
        // create a ToolExecutionComponent for each one.
        const content = message.content;
        if (!Array.isArray(content)) {
          continue;
        }
        const toolCalls = content.filter(
          (block): block is ToolCall =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "toolCall",
        );

        for (const toolCall of toolCalls) {
          let resolvedArgs: Record<string, unknown> = {};
          if (typeof toolCall.arguments === "string") {
            try {
              const parsed = jsonParse<unknown>(toolCall.arguments);
              resolvedArgs =
                typeof parsed === "object" && parsed !== null
                  ? (parsed as Record<string, unknown>)
                  : {};
            } catch {
              resolvedArgs = {};
            }
          } else if (toolCall.arguments) {
            resolvedArgs = toolCall.arguments as Record<string, unknown>;
          }

          const toolDefinition = this.toolRegistry.get(toolCall.name);

          const toolComponent = new ToolExecutionComponent(
            toolCall.name,
            toolCall.id,
            resolvedArgs,
            undefined,
            toolDefinition,
            this.tui,
            this.cwd,
          );
          toolComponent.setExpanded(true);
          container.addChild(toolComponent);
          pendingTools.set(toolCall.id, toolComponent);
        }

        // When the assistant message has an error or aborted stop reason,
        // mark all pending tool components from this message as errors.
        if ("stopReason" in message) {
          const assistantMsg = message as { stopReason: string | undefined };
          if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
            for (const toolCall of toolCalls) {
              const component_ = pendingTools.get(toolCall.id);
              if (component_) {
                component_.updateResult({ isError: true, content: [] });
                pendingTools.delete(toolCall.id);
              }
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match toolResult messages against pending tool execution components.
        if (!("toolCallId" in message)) {
          continue;
        }
        const toolResult = message as {
          toolCallId: string;
          content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
          isError: boolean;
        };
        const pendingComponent = pendingTools.get(toolResult.toolCallId);
        if (pendingComponent) {
          pendingComponent.updateResult({
            content: toolResult.content,
            isError: toolResult.isError,
          });
          pendingTools.delete(toolResult.toolCallId);
        }
      } else {
        // Fallback for messages with unrecognized roles: extract text as plain
        // content if available.
        const text = AgentDisplayHelpers.extractMessageText(message);
        if (text.length > 0) {
          if (container.children.length > 0) {
            container.addChild(new Spacer(1));
          }
          container.addChild(new UserMessageComponent(text, this.markdownTheme));
        }
      }
    }

    return container.render(width);
  }
}

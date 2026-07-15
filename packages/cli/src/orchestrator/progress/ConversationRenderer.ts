import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, type MarkdownTheme, Spacer } from "@earendil-works/pi-tui";

import { extractMessageText } from "./AgentDisplayHelpers";

/**
 * Renders an array of {@link AgentMessage} objects into styled conversation
 * lines using pi's built-in components.
 *
 * Messages are dispatched by their `role` field matching pi's rendering
 * logic:
 * - "user" messages → {@link UserMessageComponent}
 * - "assistant" messages → {@link AssistantMessageComponent}
 * - "toolResult" messages are skipped (their content is already embedded
 *   within the preceding assistant message as tool call blocks)
 *
 * Each {@link render} call is stateless — the class holds only its
 * injected dependencies (theme, markdownTheme) and produces output
 * purely from the given message list.
 */
export class ConversationRenderer {
  private readonly theme: Theme;
  private readonly markdownTheme: MarkdownTheme;

  constructor(theme: Theme, markdownTheme: MarkdownTheme) {
    this.theme = theme;
    this.markdownTheme = markdownTheme;
  }

  /**
   * Renders a user message and adds it to the container.
   */
  private renderUserMessage(message: AgentMessage, container: Container): void {
    const text = extractMessageText(message);
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
   * - "assistant" → {@link AssistantMessageComponent}
   * - "toolResult" → skipped (displayed as part of the assistant message context)
   *
   * @param messages — Agent messages in chronological order.
   * @param width — Available render width in characters.
   * @returns Styled lines ready for display (no border added).
   */
  render(messages: AgentMessage[], width: number): string[] {
    const container = new Container();

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
      } else if (message.role !== "toolResult") {
        // Fallback for messages with unrecognized roles: extract text as plain
        // content if available.
        const text = extractMessageText(message);
        if (text.length > 0) {
          if (container.children.length > 0) {
            container.addChild(new Spacer(1));
          }
          container.addChild(new UserMessageComponent(text, this.markdownTheme));
        }
      }
      // role === "toolResult" — skipped; tool results are embedded within
      // the preceding assistant message's content as tool call blocks.
    }

    return container.render(width);
  }
}

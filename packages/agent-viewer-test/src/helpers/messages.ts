import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai/base";

/**
 * Create a TextContent block.
 */
export function textBlock(text: string): TextContent {
  return { type: "text", text };
}

/**
 * Create a UserMessage with the given text.
 */
export function userMsg(text: string, ts = Date.now()): UserMessage {
  return {
    role: "user",
    content: [textBlock(text)],
    timestamp: ts,
  };
}

/**
 * Create an AssistantMessage with optional tool calls appended to the content.
 */
export function assistantMsg(
  text: string,
  toolCalls?: ToolCall[],
  ts = Date.now(),
): AssistantMessage {
  const content: AssistantMessage["content"] = [textBlock(text)];
  if (toolCalls) {
    content.push(...toolCalls);
  }
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
    timestamp: ts,
  };
}

/**
 * Create a ToolResultMessage.
 */
export function toolResultMsg(
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
  ts = Date.now(),
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [textBlock(content)],
    isError,
    timestamp: ts,
  };
}

/**
 * Create a ToolCall content block (used inside AssistantMessage.content).
 */
export function toolCallBlock(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

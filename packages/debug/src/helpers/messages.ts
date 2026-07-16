import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai/base";

export function textBlock(text: string): TextContent {
  return { type: "text", text };
}

export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

export function userMsg(text: string): UserMessage {
  const content: UserMessage["content"] = [textBlock(text)];
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

export function assistantMsg(text: string, toolCalls?: ToolCall[]): AssistantMessage {
  const content: AssistantMessage["content"] = [textBlock(text)];
  if (toolCalls) content.push(...toolCalls);
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
    timestamp: Date.now(),
  };
}

export function toolResultMsg(
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [textBlock(content)],
    isError,
    timestamp: Date.now(),
  };
}

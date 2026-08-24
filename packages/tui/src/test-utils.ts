import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** Complete Usage value for wire events. */
export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Text content block. */
export function text(text: string): TextContent {
  return { type: "text", text };
}

/** Tool-call content block. */
export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

export function assistantMessage(content: AssistantMessage["content"] = []): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "unknown",
    provider: "unknown",
    model: "unknown",
    usage: EMPTY_USAGE,
    stopReason: "stop",
    timestamp: 0,
  };
}

export function userMessage(content: UserMessage["content"] = []): UserMessage {
  return { role: "user", content, timestamp: 0 };
}

export function toolResultMessage(
  toolCallId = "tc-1",
  toolName = "tool",
  content: ToolResultMessage["content"] = [],
): ToolResultMessage {
  return { role: "toolResult", toolCallId, toolName, content, isError: false, timestamp: 0 };
}

export function messageStartEvent(message: AgentMessage): JsonAgentSessionEvent {
  return { type: "message_start", message };
}

export function messageEndEvent(message: AgentMessage): JsonAgentSessionEvent {
  return { type: "message_end", message };
}

export function messageUpdateEvent(delta: string): JsonAgentSessionEvent {
  return {
    type: "message_update",
    usage: EMPTY_USAGE,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
  };
}

export function toolStartEvent(toolName: string, args: unknown = undefined): JsonAgentSessionEvent {
  return { type: "tool_execution_start", toolCallId: "tc-1", toolName, args };
}

export function toolEndEvent(
  toolName: string,
  result = "",
  isError = false,
): JsonAgentSessionEvent {
  return { type: "tool_execution_end", toolCallId: "tc-1", toolName, result, isError };
}

export function toolUpdateEvent(toolName: string, partialResult?: unknown): JsonAgentSessionEvent {
  return {
    type: "tool_execution_update",
    toolCallId: "tc-1",
    toolName,
    args: {},
    partialResult,
  };
}

export function agentStartEvent(): JsonAgentSessionEvent {
  return { type: "agent_start" };
}

export function agentEndEvent(): JsonAgentSessionEvent {
  return { type: "agent_end", messages: [], willRetry: false };
}

export function turnStartEvent(): JsonAgentSessionEvent {
  return { type: "turn_start" };
}

export function turnEndEvent(message = assistantMessage()): JsonAgentSessionEvent {
  return { type: "turn_end", message, toolResults: [] };
}

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** One assistant-message delta as emitted on the RPC/JSON wire (pi >= 0.84). */
export type WireAssistantDelta = {
  type: "text_delta";
  contentIndex: number;
  delta: string;
};

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function agentStartEvent(): JsonAgentSessionEvent {
  return { type: "agent_start" };
}
export function agentEndEvent(): JsonAgentSessionEvent {
  return { type: "agent_end", messages: [], willRetry: false };
}

export function turnStartEvent(): JsonAgentSessionEvent {
  return { type: "turn_start" };
}
export function turnEndEvent(
  message: AssistantMessage,
  toolResults: ToolResultMessage[],
): JsonAgentSessionEvent {
  return { type: "turn_end", message, toolResults };
}
export function messageStartEvent(message: AgentMessage): JsonAgentSessionEvent {
  return { type: "message_start", message };
}
export function messageUpdateEvent(
  assistantMessageEvent: WireAssistantDelta,
): JsonAgentSessionEvent {
  return { type: "message_update", usage: EMPTY_USAGE, assistantMessageEvent };
}
export function messageEndEvent(message: AgentMessage): JsonAgentSessionEvent {
  return { type: "message_end", message };
}
export function toolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): JsonAgentSessionEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}
export function toolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: string,
  isError: boolean,
): JsonAgentSessionEvent {
  return { type: "tool_execution_end", toolCallId, toolName, result, isError };
}
export function textDeltaEvent(contentIndex: number, delta: string): WireAssistantDelta {
  return { type: "text_delta", contentIndex, delta };
}

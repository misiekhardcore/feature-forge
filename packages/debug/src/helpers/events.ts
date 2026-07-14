import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
} from "@earendil-works/pi-ai/base";

export function agentStartEvent(): AgentEvent {
  return { type: "agent_start" };
}
export function agentEndEvent(): AgentEvent {
  return { type: "agent_end", messages: [] };
}
export function turnStartEvent(): AgentEvent {
  return { type: "turn_start" };
}
export function turnEndEvent(
  message: AssistantMessage,
  toolResults: ToolResultMessage[],
): AgentEvent {
  return { type: "turn_end", message, toolResults };
}
export function messageStartEvent(message: AssistantMessage): AgentEvent {
  return { type: "message_start", message };
}
export function messageUpdateEvent(
  message: AssistantMessage,
  assistantMessageEvent: AssistantMessageEvent,
): AgentEvent {
  return { type: "message_update", message, assistantMessageEvent };
}
export function messageEndEvent(message: AssistantMessage): AgentEvent {
  return { type: "message_end", message };
}
export function toolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}
export function toolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: string,
  isError: boolean,
): AgentEvent {
  return { type: "tool_execution_end", toolCallId, toolName, result, isError };
}
export function textDeltaEvent(
  contentIndex: number,
  delta: string,
  partial: AssistantMessage,
): AssistantMessageEvent {
  return { type: "text_delta", contentIndex, delta, partial };
}

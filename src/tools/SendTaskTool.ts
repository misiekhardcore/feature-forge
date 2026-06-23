import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { SendTaskParams } from "../ipc";
import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { SendTaskResult } from "../ipc/messages";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class SendTaskTool extends Tool {
  readonly name = "send_task";
  readonly label = "Send Task";
  readonly description =
    "Send a task to a spawned agent. " +
    "When await is true, blocks until the agent completes and returns the result. " +
    "When await is false, returns immediately with 'dispatched' status; " +
    "the result is delivered asynchronously via an agent_update notification.";

  readonly parameters = Type.Object({
    agentIdentifier: Type.String({ description: "Agent identifier returned by spawn_agent" }),
    task: Type.String({ description: "The task description to send to the agent" }),
    await: Type.Boolean({
      description:
        "If true, wait for the agent to finish. " +
        "If false, dispatch in background and receive result later",
    }),
  });

  renderShell = "self";
  renderCall = ToolRenderer.sendTaskCall;
  renderResult = ToolRenderer.sendTaskResult;

  constructor(private client: ChildSocketClient | null) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: SendTaskParams,
  ): Promise<AgentToolResult<SendTaskResult | { error: string }>> {
    if (!this.client) {
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    try {
      const result = await this.client.request("send_task", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          },
        ],
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}

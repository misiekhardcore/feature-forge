import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { IpcTool } from "@feature-forge/core";
import { ToolRenderer } from "@feature-forge/tui";
import { Type } from "typebox";

import { SendTaskParams, SendTaskResult } from "../ipc/messages";

const SendTaskParameters = Type.Object({
  agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
  prompt: Type.String({ description: "The task description to send to the agent" }),
  await: Type.Boolean({
    description:
      "If true, wait for the agent to finish. " +
      "If false, dispatch in background and receive result later",
  }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Optional timeout in milliseconds for this dispatch. " + "Overrides the default when set.",
    }),
  ),
});

export class SendTaskTool extends IpcTool<typeof SendTaskParameters, SendTaskResult> {
  readonly name = "send_task";
  readonly label = "Send Task";
  readonly description =
    "Send a task to a spawned agent. " +
    "When await is true, blocks until the agent completes and returns the result. " +
    "When await is false, returns immediately with 'dispatched' status; " +
    "the result is delivered asynchronously via an agent_update notification.";

  readonly parameters = SendTaskParameters;
  protected readonly messageType = "send_task";

  renderShell = "self";
  renderCall = ToolRenderer.sendTaskCall;
  renderResult = ToolRenderer.sendTaskResult;

  async execute(
    _toolCallId: string,
    params: SendTaskParams,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<SendTaskResult | { error: string }>> {
    return this.ipc(params, params.timeout, signal);
  }
}

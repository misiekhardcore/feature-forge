import { IpcTool } from "@feature-forge/core";
import { ToolRenderer } from "@feature-forge/tui";
import { Type } from "typebox";

import { DestroyAgentResult } from "../ipc/messages";

const DestroyAgentParameters = Type.Object({
  agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
});

export class DestroyAgentTool extends IpcTool<typeof DestroyAgentParameters, DestroyAgentResult> {
  readonly name = "destroy_agent";
  readonly label = "Destroy Agent";
  readonly description = "Destroy a previously spawned agent and clean up its resources.";

  readonly parameters = DestroyAgentParameters;
  protected readonly messageType = "destroy_agent";

  renderShell = "self";
  renderCall = ToolRenderer.destroyAgentCall;
  renderResult = ToolRenderer.destroyAgentResult;
}

import { IpcTool } from "@feature-forge/core";
import { DestroyAgentResult } from "@feature-forge/core/src/ipc/messages";
import { ToolRenderer } from "@feature-forge/tui";
import { Type } from "typebox";

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

import type { Theme } from "@earendil-works/pi-coding-agent";
import { IpcTool } from "@feature-forge/core";
import { DestroyAgentResult } from "@feature-forge/core/ipc";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

const DestroyAgentParameters = Type.Object({
  agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
});

type DestroyAgentArgs = Static<typeof DestroyAgentParameters>;

export class DestroyAgentTool
  extends IpcTool<typeof DestroyAgentParameters, DestroyAgentResult>
  implements RenderableTool<typeof DestroyAgentParameters, DestroyAgentResult | { error: string }>
{
  readonly name = "destroy_agent";
  readonly label = "Destroy Agent";
  readonly description = "Destroy a previously spawned agent and clean up its resources.";

  readonly parameters = DestroyAgentParameters;
  protected readonly messageType = "destroy_agent";

  renderShell = "self" as const;

  renderCall = (args: DestroyAgentArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "toolErrorBg", ({ line }) => {
      line(ToolRenderer.header(theme, "error", `destroy_agent ${args.agentId}`));
    });

  renderResult = ToolRenderer.simpleResult;
}

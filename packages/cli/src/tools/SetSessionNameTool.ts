import type { AgentToolResult, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

const SetSessionNameParams = Type.Object({
  name: Type.String({ description: "Display name for the session", minLength: 1 }),
});

type SetSessionNameArgs = Static<typeof SetSessionNameParams>;

export class SetSessionNameTool
  extends Tool
  implements RenderableTool<typeof SetSessionNameParams>
{
  readonly name = "set_session_name";
  readonly label = "Set Session Name";
  readonly description =
    'Set a human-readable name for this session (e.g. "implement #172 — validation gates")';
  readonly parameters = SetSessionNameParams;

  // Literal type required: this tool is passed directly to pi.registerTool(),
  // unlike sibling tools whose concrete type is erased via ToolRegistry's
  // Tool-typed parameter (inferred `string` would not match "self").
  renderShell = "self" as const;

  renderCall = (args: SetSessionNameArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "toolSuccessBg", ({ line }) => {
      line(ToolRenderer.header(theme, "success", `set_session_name ${args.name}`));
    });

  renderResult = ToolRenderer.messageResult;

  constructor(private pi: ExtensionAPI) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: SetSessionNameArgs,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const { name } = params;
    this.pi.setSessionName(name);
    return {
      content: [{ type: "text", text: `Session named: ${name}` }],
      details: undefined,
    };
  }
}

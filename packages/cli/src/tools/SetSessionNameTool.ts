import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import { Type } from "typebox";

const SetSessionNameParams = Type.Object({
  name: Type.String({ description: "Display name for the session", minLength: 1 }),
});

export class SetSessionNameTool extends Tool {
  readonly name = "set_session_name";
  readonly label = "Set Session Name";
  readonly description =
    'Set a human-readable name for this session (e.g. "implement #172 — validation gates")';
  readonly parameters = SetSessionNameParams;

  // Literal type required: this tool is passed directly to pi.registerTool(),
  // unlike sibling tools whose concrete type is erased via ToolRegistry's
  // Tool-typed parameter (inferred `string` would not match "self").
  renderShell = "self" as const;

  constructor(private pi: ExtensionAPI) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: { name: string },
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    this.pi.setSessionName(params.name);
    return {
      content: [{ type: "text", text: `Session named: ${params.name}` }],
      details: undefined,
    };
  }
}

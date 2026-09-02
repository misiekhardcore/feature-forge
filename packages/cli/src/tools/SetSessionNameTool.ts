import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import type { Static } from "typebox";
import { Type } from "typebox";

import { ToolRenderer } from "../tui/views/ToolRenderer";

const SetSessionNameParams = Type.Object({
  name: Type.String({ description: "Display name for the session", minLength: 1 }),
});

export class SetSessionNameTool extends Tool<typeof SetSessionNameParams> {
  readonly name = "set_session_name";
  readonly label = "Set Session Name";
  readonly description =
    'Set a human-readable name for this session (e.g. "implement #172 — validation gates")';
  readonly parameters = SetSessionNameParams;

  // Literal type required: this tool is passed directly to pi.registerTool(),
  // unlike sibling tools whose concrete type is erased via ToolRegistry's
  // Tool-typed parameter (inferred `string` would not match "self").
  renderShell = "self" as const;

  renderCall = ToolRenderer.setSessionNameCall;
  renderResult = ToolRenderer.setSessionNameResult;

  constructor(private pi: ExtensionAPI) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const { name } = params as Static<typeof SetSessionNameParams>;
    this.pi.setSessionName(name);
    return {
      content: [{ type: "text", text: `Session named: ${name}` }],
      details: undefined,
    };
  }
}

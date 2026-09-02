import type { Theme } from "@earendil-works/pi-coding-agent";
import { IpcTool } from "@feature-forge/core";
import { SpawnAgentResult } from "@feature-forge/core/ipc";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

/**
 * Schema for the spawn_agent tool — single unambiguous mode.
 *
 * All values are fully resolved before they reach the IPC layer:
 * `systemPrompt` is the complete persona text, `prompt` is an optional
 * initial task. No template variables or spec name lookups.
 */
export const SpawnAgentParameters = Type.Object({
  role: Type.String({
    description: "Display role name for the spawned agent.",
  }),
  systemPrompt: Type.String({
    description: "Resolved persona text sent as the system prompt (no placeholders).",
  }),
  prompt: Type.Optional(
    Type.String({
      description: "Optional initial task the agent should execute immediately.",
    }),
  ),
  toolRestrictions: Type.Readonly(
    Type.Record(Type.String(), Type.Array(Type.String()), {
      description:
        "Per-tool pattern restrictions. Each key is a tool name, value is a list of glob patterns (empty array = unrestricted).",
    }),
  ),
  skills: Type.Optional(
    Type.Readonly(
      Type.Array(Type.String(), {
        description:
          "Allowlist of skill names to load for this agent. Empty = use default discovery.",
      }),
    ),
  ),
  excludedSkills: Type.Optional(
    Type.Readonly(
      Type.Array(Type.String(), {
        description: "Denylist of skill names to disable. Overrides skills.",
      }),
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: 'Optional model preference (e.g. "claude-sonnet-4-5").',
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Optional working directory.",
    }),
  ),
});

type SpawnAgentArgs = Static<typeof SpawnAgentParameters>;

export class SpawnAgentTool
  extends IpcTool<typeof SpawnAgentParameters, SpawnAgentResult>
  implements RenderableTool<typeof SpawnAgentParameters, SpawnAgentResult | { error: string }>
{
  readonly name = "spawn_agent";
  readonly label = "Spawn Agent";
  readonly description =
    "Create a sub-agent with a label, system prompt, and optional initial task. " +
    "Returns an agentId for use with send_task, get_agent_result, and destroy_agent.";

  readonly parameters = SpawnAgentParameters;
  protected readonly messageType = "spawn_agent";

  renderShell = "self" as const;

  renderCall = (args: SpawnAgentArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "toolPendingBg", ({ line, expandable }) => {
      let content = ToolRenderer.header(theme, "success", `spawn_agent ${args.role}`);
      if (args.model) {
        content += " " + theme.fg("muted", `(${args.model})`);
      }
      line(content);
      expandable(args.systemPrompt, "muted");
    });

  renderResult = ToolRenderer.simpleResult;
}

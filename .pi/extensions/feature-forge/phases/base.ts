import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { AgentSpawner, AgentSpawnOptions } from "../pi-spawner";
import Type from "typebox";

const SpawnSubAgentParams = Type.Object({
  name: Type.String({
    description:
      "The name of the agent prompt file (without .md extension) to load from the agents/ directory.",
  }),
  variables: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Key-value pairs to replace in the agent prompt for dynamic content.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "The working directory for the sub-agent process." }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({ description: "Maximum time in milliseconds to allow the sub-agent to run." }),
  ),
});

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

export abstract class Phase {
  protected readonly pi: ExtensionAPI;
  private readonly dir: string;

  constructor(pi: ExtensionAPI, dir: string) {
    this.pi = pi;
    this.dir = dir;
  }

  abstract readonly name: string;
  abstract readonly description: string;

  /** Register this phase's command. Called by registerPhases after construction. */
  public register(): void {
    this.pi.registerCommand(this.name, {
      description: this.description,
      handler: this.handler.bind(this),
    });
    this.pi.registerTool(this.spawnSubAgentTool);
  }

  abstract handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void>;

  private loadFileContent = (filePath: string, variables?: Record<string, string>): string => {
    let content = readFileSync(filePath, "utf-8").trim();
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`{{${key}}}`, "g"), value);
      }
    }
    return content;
  };

  /** Load a main prompt from this phase's `prompts/` directory. */
  protected loadPromptContent = (name: string, variables?: Record<string, string>): string => {
    return this.loadFileContent(join(this.dir, "prompts", `${name}.md`), variables);
  };

  /** Load a sub-agent instruction from this phase's `agents/` directory. */
  protected loadAgentContent = (name: string, variables?: Record<string, string>): string => {
    return this.loadFileContent(join(this.dir, "agents", `${name}.md`), variables);
  };

  protected spawnSubAgent = <T>(
    name: string,
    variables?: Record<string, string>,
    options?: AgentSpawnOptions,
  ): Promise<AgentToolResult<T>> => {
    const spawner = new AgentSpawner();
    const prompt = this.loadAgentContent(name, variables);
    return spawner.run(prompt, options);
  };

  protected spawnSubAgentTool: ToolDefinition<typeof SpawnSubAgentParams> = {
    name: "spawn_sub_agent",
    label: "Spawn Sub-Agent",
    description:
      "Spawn a sub-agent with a specific prompt from this phase's `agents/` directory. Runs in an isolated context and returns the final output.",
    promptSnippet:
      "Use spawn_sub_agent to run a sub-agent with a prompt from the agents/ directory.",
    promptGuidelines: [
      "Use spawn_sub_agent when you want to delegate a specific task or research to a sub-agent with its own context.",
      "Choose the appropriate agent prompt based on the task. For example, use a 'research' agent for codebase exploration tasks.",
      "Pass necessary variables to customize the agent's prompt for the current situation.",
    ],
    parameters: SpawnSubAgentParams,
    execute: (_toolCallId, params, signal, _onUpdate, ctx) => {
      const { name, variables, cwd, timeoutMs } = params;
      return this.spawnSubAgent(name, variables, {
        cwd: cwd ?? ctx.cwd,
        timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal,
        env: {
          // Forward the parent process's environment variables to the sub-agent
          ...process.env,
        },
        forwardStderr: true, // Forward stderr for visibility into sub-agent execution
      });
    },
  };
}

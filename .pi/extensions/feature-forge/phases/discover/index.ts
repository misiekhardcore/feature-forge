import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import Type from "typebox";
import { Phase } from "../base";

const __dir = dirname(fileURLToPath(import.meta.url));

const ResearchAgentParams = Type.Object({
  question: Type.String({
    description:
      "What to investigate — be specific. Example: 'What pattern does the existing help formatter use for flag descriptions?'",
  }),
});

export class DiscoverPhase extends Phase {
  readonly name = "discover";
  readonly description = "Interactive feature discovery interview → GitHub issue";

  constructor(pi: ExtensionAPI) {
    super(pi, __dir);
    this.pi.registerTool(this.researchCodebaseTool);
  }

  handler = async (args: string | undefined, ctx: ExtensionCommandContext): Promise<void> => {
    const idea = args?.trim();
    if (!idea) {
      return Promise.resolve(ctx.ui.notify("Usage: /discover <feature idea>", "error"));
    }

    const prompt = this.loadPromptContent("main", { idea });

    return this.pi.sendUserMessage([{ type: "text", text: prompt }]);
  };

  private researchCodebaseTool: ToolDefinition<typeof ResearchAgentParams> = {
    name: "research_codebase",
    label: "Research Codebase",
    description:
      "Explore the codebase for patterns, conventions, or constraints relevant to the current feature discussion. Runs in an isolated context and returns concise findings.",
    promptSnippet:
      "Use research_codebase to investigate code patterns and conventions in an isolated sub-agent.",
    promptGuidelines: [
      "Use research_codebase when you need to understand code structure, conventions, or constraints instead of reading files directly in the main thread.",
      "Prefer asking the user clarifying questions first. Only research if understanding requires code exploration.",
      "Keep research targeted — one specific question per call.",
    ],
    parameters: ResearchAgentParams,
    execute: (_toolCallId, params, signal, _onUpdate, ctx) => {
      return this.spawnSubAgent("research_agent", params, {
        cwd: ctx.cwd,
        signal,
        forwardStderr: true, // Forward stderr for visibility into sub-agent execution
      });
    },
  };
}

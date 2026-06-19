import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Phase } from "../base";
import { PiSpawner } from "../../pi-spawner";

const __dir = dirname(fileURLToPath(import.meta.url));

export class DiscoverPhase extends Phase {
  readonly name = "discover";
  readonly description = "Interactive feature discovery interview → GitHub issue";

  constructor(pi: ExtensionAPI) {
    super(pi, __dir);
    this.registerResearchTool();
  }

  private registerResearchTool(): void {
    this.pi.registerTool({
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
      parameters: Type.Object({
        question: Type.String({
          description:
            "What to investigate — be specific. Example: 'What pattern does the existing help formatter use for flag descriptions?'",
        }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const spawner = new PiSpawner();
        const prompt = [
          "You are a focused research agent. Answer the question concisely.",
          "",
          `Question: ${params.question}`,
          "",
          "Explore the codebase using read, grep, and ls. Return only relevant findings.",
          "Be specific: name files, functions, patterns.",
          "If the answer is not in the codebase, say so clearly.",
          "",
          "## Handoff",
          "- findings: |",
          "  Your findings here.",
        ].join("\n");

        const { stdout } = await spawner.run(prompt, { cwd: ctx.cwd });
        return {
          content: [{ type: "text", text: stdout }],
          details: {},
        };
      },
    });
  }

  handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
    const idea = args?.trim();
    if (!idea) {
      return Promise.resolve(ctx.ui.notify("Usage: /discover <feature idea>", "error"));
    }

    const prompt = this.loadPrompt("main");

    this.pi.sendUserMessage([
      { type: "text", text: prompt },
      {
        type: "text",
        text: `\n\n**Feature idea to explore**: ${idea}\n\nStart by asking your first question.`,
      },
    ]);
    return Promise.resolve();
  }
}

import { AgentIdentifier } from "../base";
import { AgentSpecification } from "./AgentSpecification";
import { TOOL_PRESETS } from "./constants";
import { loadPromptTemplate } from "./templates";

/**
 * Optional context for parameterizing the research agent's system prompt.
 */
export interface ResearchContext {
  /** A specific area or topic to focus the investigation on. */
  focus?: string;
  /** File paths or URLs the agent should examine. */
  sources?: string[];
}

/**
 * Pre-configured specification for a read-only research agent.
 *
 * Spawned with only read-only tools (read, grep, ls), extensions disabled
 * for isolation, and instructed to produce complete self-contained reports.
 *
 * Accepts optional {@link ResearchContext} to inject focus area or sources
 * into the system prompt. The context section is rendered from
 * `prompts/_context.md` and injected at `{{CONTEXT}}`.
 */
export class ResearchAgentSpecification extends AgentSpecification {
  constructor(context?: ResearchContext) {
    super({
      identifier: new AgentIdentifier("researcher"),
      role: "researcher",
      systemPrompt: loadPromptTemplate("research", {
        CONTEXT: buildContextBlock(context),
      }),
      toolNames: TOOL_PRESETS.readOnly,
      ephemeral: true,
    });
  }
}

/**
 * Build the context section from typed research parameters.
 *
 * The section template (`prompts/_context.md`) provides the layout;
 * this function only supplies the substitution values.
 */
function buildContextBlock(context?: ResearchContext): string {
  let result = "";
  if (context?.focus) {
    result += `Focus: ${context.focus}\n`;
  }
  if (context?.sources?.length) {
    result += "Sources:\n";
    for (const source of context.sources) {
      result += `  - ${source}\n`;
    }
  }
  return result.trim();
}

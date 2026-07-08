import { AgentSpecification } from "../specifications";

/**
 * Converts an AgentSpecification into pi CLI arguments.
 *
 * Only fields that have no runtime ExtensionAPI equivalent are passed
 * via CLI flags. Fields handled through FORGE_SPEC child-side resolution
 * (tools, excludedTools, toolRestrictions, thinkingLevel, systemPrompt)
 * are intentionally excluded — they are applied in activateSpecResolution().
 */
export function buildPiCliArguments(specification: AgentSpecification): string[] {
  const args: string[] = [];

  if (specification.disableBuiltinTools) {
    args.push("--no-builtin-tools");
  }

  // --- Resource loading ---
  if (specification.disableExtensions) {
    args.push("--no-extensions");
  }
  if (specification.disableSkills) {
    args.push("--no-skills");
  }
  if (specification.disablePromptTemplates) {
    args.push("--no-prompt-templates");
  }
  if (specification.disableContextFiles) {
    args.push("--no-context-files");
  }

  // --- Session ---
  if (specification.ephemeral) {
    args.push("--no-session");
  }

  return args;
}

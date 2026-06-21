import { AgentSpecification } from "../specifications";

/**
 * Converts an AgentSpecification into pi CLI arguments.
 *
 * Every specification field that maps to a CLI flag is translated here.
 * Callers (factories, tests, direct spawns) use this single helper instead
 * of duplicating the mapping logic.
 */
export function buildPiCliArguments(specification: AgentSpecification): string[] {
  const args: string[] = [];

  // --- Tools ---
  if (specification.toolNames.length > 0) {
    args.push("--tools", specification.toolNames.join(","));
  }
  if (specification.excludeToolNames.length > 0) {
    args.push("--exclude-tools", specification.excludeToolNames.join(","));
  }
  if (specification.disableBuiltinTools) {
    args.push("--no-builtin-tools");
  }

  // --- Reasoning ---
  if (specification.thinkingLevel) {
    args.push("--thinking", specification.thinkingLevel);
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

import { AgentSpecification, resolveSkillPaths } from "../specifications";

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

  // --- Selective skill loading ---
  // When skills or excludedSkills are specified, compute the effective set
  // and emit --no-skills + --skill <path> for each allowed skill.
  // This overrides auto-discovery with an explicit allowlist.
  if (
    !specification.disableSkills &&
    (specification.skills.length > 0 || specification.excludedSkills.length > 0)
  ) {
    const skillPaths = resolveSkillPaths(specification.skills, specification.excludedSkills);
    args.push("--no-skills");
    for (const skillPath of skillPaths) {
      args.push("--skill", skillPath);
    }
  }

  // --- Session ---
  if (specification.ephemeral) {
    args.push("--no-session");
  }

  return args;
}

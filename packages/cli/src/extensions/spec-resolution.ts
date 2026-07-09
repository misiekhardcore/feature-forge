import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { DynamicAgentSpecification } from "../agents/specifications/DynamicAgentSpecification";
import { activateToolRestrictions } from "./tool-restrictions";

/**
 * Register hooks for child-side spec resolution.
 *
 * When FORGE_SPEC is set (child process receives full spec as JSON),
 * deserialize and apply tools, system prompt, and bash pattern
 * restrictions locally instead of relying on CLI arguments.
 */
export function activateSpecResolution(pi: ExtensionAPI): void {
  let childSpec: DynamicAgentSpecification | null = null;

  // Set systemPrompt for child subprocess from FORGE_SPEC.
  // Registered at module level so it is always active — returns the
  // spec's systemPrompt when childSpec has been set by session_start.
  pi.on("before_agent_start", (_event) => {
    if (!childSpec) return undefined;
    return { systemPrompt: childSpec.systemPrompt };
  });

  pi.on("session_start", () => {
    const forgeSpecRaw = process.env.FORGE_SPEC;
    if (!forgeSpecRaw) return;

    try {
      const spec = DynamicAgentSpecification.fromJSON(forgeSpecRaw);

      if (spec.tools.length > 0) {
        const effectiveTools =
          spec.excludedTools.length > 0
            ? spec.tools.filter((tool) => !spec.excludedTools.includes(tool))
            : [...spec.tools];
        pi.setActiveTools(effectiveTools);
      } else if (spec.excludedTools.length > 0) {
        const defaultTools = pi.getActiveTools();
        const effectiveTools = defaultTools.filter((tool) => !spec.excludedTools.includes(tool));
        pi.setActiveTools(effectiveTools);
      }

      if (spec.thinkingLevel !== undefined) {
        pi.setThinkingLevel(spec.thinkingLevel);
      }

      activateToolRestrictions(pi, spec.toolRestrictions);

      childSpec = spec;
    } catch (error) {
      console.error("Failed to deserialize FORGE_SPEC", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

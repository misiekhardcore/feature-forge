import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import { AgentSpecification } from "@feature-forge/core/agents";
import { DynamicAgentSpecification } from "@feature-forge/core/agents";

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
      const { fullExclusions, partialRestrictions } = AgentSpecification.parseExcludedTools(
        spec.excludedTools,
      );

      if (spec.tools.length > 0) {
        pi.setActiveTools(spec.tools.filter((tool) => !fullExclusions.has(tool)));
      } else if (fullExclusions.size > 0) {
        const defaultTools = pi.getActiveTools();
        pi.setActiveTools(defaultTools.filter((tool) => !fullExclusions.has(tool)));
      }

      if (spec.thinkingLevel !== undefined) {
        pi.setThinkingLevel(spec.thinkingLevel);
      }

      // Partial restrictions ("tool:pattern") keep the tool active but add
      // pattern limits — merge them with the spec's own toolRestrictions.
      const mergedRestrictions: Record<string, readonly string[]> = {
        ...spec.toolRestrictions,
      };
      for (const [tool, patterns] of Object.entries(partialRestrictions)) {
        mergedRestrictions[tool] = [...(mergedRestrictions[tool] ?? []), ...patterns];
      }
      activateToolRestrictions(pi, mergedRestrictions, process.cwd());

      childSpec = spec;
    } catch (error) {
      logger.error("Failed to deserialize FORGE_SPEC", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

import type { AgentModelConfig } from "./ForgeConfigSchema";

export function resolveModel(
  rawModel: string | undefined,
  models: Readonly<Record<string, AgentModelConfig>>,
): AgentModelConfig | undefined {
  if (rawModel === undefined) return undefined;

  // Check if rawModel is a preset alias
  if (rawModel in models) {
    return models[rawModel];
  }

  // Treat as raw model string — passthrough
  return { model: rawModel };
}

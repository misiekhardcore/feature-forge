import type { AgentModelConfig } from "./ForgeConfigSchema";
import type { ResolvedModelConfig } from "./ForgeConfigSchema";

export function resolveModel(
  rawModel: string | undefined,
  models: Readonly<Record<string, AgentModelConfig>>,
): ResolvedModelConfig | undefined {
  if (rawModel === undefined) return undefined;

  // Check if rawModel is a preset alias — own-property lookup only so
  // prototype-chain keys ("constructor", "toString", "__proto__") never
  // resolve to a config without a `model` field.
  if (Object.hasOwn(models, rawModel)) {
    return { ...models[rawModel], resolved: true };
  }

  // Treat as raw model string — passthrough
  return { model: rawModel, resolved: false };
}

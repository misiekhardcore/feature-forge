import { ModelConfig } from "./ModelConfig";

/** Parameters for constructing a FeatureForgeConfig value object. */
export type FeatureForgeConfigParams = {
  /**
   * Model configurations keyed by effort tier ("high" / "medium" / "low").
   * Users configure these in settings.json under the "feature-forge" key.
   */
  models?: Record<string, ModelConfig>;
};

/**
 * Immutable top-level configuration for the feature-forge extension.
 *
 * Loaded from Pi's settings.json via {@link CascadingConfigLoader} and injected
 * into components that need runtime configuration (agent factory, spec manager).
 */
export class FeatureForgeConfig {
  /** Model configurations keyed by effort tier. */
  public readonly models: Record<string, ModelConfig>;

  constructor(params: FeatureForgeConfigParams = {}) {
    this.models = params.models ?? {};
  }

  /**
   * Look up the model configuration for a named effort tier.
   *
   * @returns the matching ModelConfig, or `undefined` when the tier isn't configured.
   */
  getModel(effort: string): ModelConfig | undefined {
    return this.models[effort];
  }

  /** Structural equality based on all fields. */
  equals(other: unknown): boolean {
    if (!(other instanceof FeatureForgeConfig)) return false;
    const ownKeys = Object.keys(this.models).sort();
    const otherKeys = Object.keys(other.models).sort();
    if (ownKeys.length !== otherKeys.length) return false;
    for (let i = 0; i < ownKeys.length; i++) {
      const key = ownKeys[i];
      if (key !== otherKeys[i]) return false;
      if (!this.models[key].equals(other.models[key])) return false;
    }
    return true;
  }

  /** Human-readable representation for debug/log output. */
  toString(): string {
    const entries = Object.entries(this.models)
      .map(([key, model]) => `  ${key}: ${model.toString()}`)
      .join("\n");
    return entries.length > 0
      ? `FeatureForgeConfig {\n${entries}\n}`
      : "FeatureForgeConfig { (empty) }";
  }
}

import { ConfigSource } from "./ConfigSource";
import { FeatureForgeConfig } from "./FeatureForgeConfig";

/** Parameters for constructing a CascadingConfigLoader. */
export type CascadingConfigLoaderParams = {
  /**
   * Configuration sources in priority order (highest priority first).
   * Typical ordering: project-level source, then global source, then defaults.
   */
  sources: ConfigSource[];
};

/**
 * Chains multiple {@link ConfigSource} instances and merges their results.
 *
 * Sources are tried in the order they appear in the constructor. When a
 * source returns a config, its models are merged into the accumulated
 * result — earlier (higher-priority) sources override later ones on a
 * per-effort-tier basis.
 *
 * Merging is per-model: if the project-level source defines `models.high`
 * and the global source defines `models.high` and `models.medium`, the
 * final result includes project's `high` and global's `medium`.
 */
export class CascadingConfigLoader {
  private readonly sources: readonly ConfigSource[];

  constructor(params: CascadingConfigLoaderParams) {
    if (params.sources.length === 0) {
      throw new Error("CascadingConfigLoader requires at least one ConfigSource");
    }
    this.sources = [...params.sources];
  }

  /**
   * Load configuration from all sources, merging with earlier sources
   * taking priority.
   *
   * @returns a fully merged {@link FeatureForgeConfig}, never undefined.
   */
  async load(): Promise<FeatureForgeConfig> {
    const merged: Record<string, FeatureForgeConfig> = {};

    // Iterate from lowest priority (defaults) to highest (project).
    for (let index = this.sources.length - 1; index >= 0; index--) {
      const config = await this.sources[index].load();
      if (config) {
        merged[index] = config;
      }
    }

    // Merge models: earlier sources (higher priority) win per effort tier.
    const models: Record<string, FeatureForgeConfig["models"][string]> = {};
    for (let index = this.sources.length - 1; index >= 0; index--) {
      const config = merged[index];
      if (config) {
        Object.assign(models, config.models);
      }
    }

    return new FeatureForgeConfig({ models });
  }
}

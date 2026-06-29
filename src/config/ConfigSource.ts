import type { FeatureForgeConfig } from "./FeatureForgeConfig";

/**
 * A source of feature-forge configuration.
 *
 * Implementations may read from files, environment variables, or provide
 * hardcoded defaults. {@link CascadingConfigLoader} chains multiple sources
 * together with project-level sources taking precedence over global ones.
 */
export abstract class ConfigSource {
  /**
   * Load configuration from this source.
   *
   * @returns a partial feature-forge config, or `undefined` when this source
   *          has nothing to contribute (missing file, no matching keys, etc.).
   */
  abstract load(): Promise<FeatureForgeConfig | undefined>;
}

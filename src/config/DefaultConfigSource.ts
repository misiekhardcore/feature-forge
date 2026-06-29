import { ConfigSource } from "./ConfigSource";
import { FeatureForgeConfig } from "./FeatureForgeConfig";

/**
 * A {@link ConfigSource} that returns a built-in, empty configuration.
 *
 * Serves as the lowest-priority fallback so that even when no settings.json
 * files exist the config loader always produces a valid result.
 */
export class DefaultConfigSource extends ConfigSource {
  public override async load(): Promise<FeatureForgeConfig> {
    return new FeatureForgeConfig();
  }
}

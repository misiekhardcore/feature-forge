import { describe, expect, it } from "vitest";

import { CascadingConfigLoader } from "./CascadingConfigLoader";
import { ConfigSource } from "./ConfigSource";
import { DefaultConfigSource } from "./DefaultConfigSource";
import { FeatureForgeConfig } from "./FeatureForgeConfig";
import { ModelConfig } from "./ModelConfig";

/**
 * A ConfigSource that returns a fixed config, simulating a file read.
 */
class FixedConfigSource extends ConfigSource {
  constructor(private readonly config: FeatureForgeConfig | undefined) {
    super();
  }

  public override async load(): Promise<FeatureForgeConfig | undefined> {
    return this.config;
  }
}

function makeModel(modelId: string, thinkingLevel?: string): ModelConfig {
  return new ModelConfig({
    modelId,
    thinkingLevel: thinkingLevel as "off" | "low" | "medium" | "high" | undefined,
  });
}

describe("CascadingConfigLoader", () => {
  describe("constructor", () => {
    it("throws when no sources are provided", () => {
      expect(() => new CascadingConfigLoader({ sources: [] })).toThrow(
        "requires at least one ConfigSource",
      );
    });
  });

  describe("load", () => {
    it("returns the config from a single source", async () => {
      const expected = new FeatureForgeConfig({
        models: { high: makeModel("sonnet", "high") },
      });
      const loader = new CascadingConfigLoader({ sources: [new FixedConfigSource(expected)] });
      const result = await loader.load();

      expect(result.equals(expected)).toBe(true);
    });

    it("falls back to the next source when the first returns undefined", async () => {
      const fallback = new FeatureForgeConfig({
        models: { high: makeModel("fallback") },
      });
      const loader = new CascadingConfigLoader({
        sources: [new FixedConfigSource(undefined), new FixedConfigSource(fallback)],
      });
      const result = await loader.load();

      expect(result.equals(fallback)).toBe(true);
    });

    it("gives higher priority to earlier sources", async () => {
      const highPriority = new FeatureForgeConfig({
        models: { high: makeModel("priority-model") },
      });
      const lowPriority = new FeatureForgeConfig({
        models: { high: makeModel("shadowed-model") },
      });
      const loader = new CascadingConfigLoader({
        sources: [new FixedConfigSource(highPriority), new FixedConfigSource(lowPriority)],
      });
      const result = await loader.load();

      expect(result.getModel("high")!.modelId).toBe("priority-model");
    });

    it("merges models from multiple sources with earlier winning per-tier", async () => {
      // Project source: only defines "high"
      const project = new FeatureForgeConfig({
        models: { high: makeModel("project-high") },
      });
      // Global source: defines "high" and "medium"
      const global = new FeatureForgeConfig({
        models: {
          high: makeModel("global-high"),
          medium: makeModel("global-medium"),
        },
      });
      const loader = new CascadingConfigLoader({
        sources: [new FixedConfigSource(project), new FixedConfigSource(global)],
      });
      const result = await loader.load();

      // Project "high" wins, global "medium" survives
      expect(result.getModel("high")!.modelId).toBe("project-high");
      expect(result.getModel("medium")!.modelId).toBe("global-medium");
      expect(result.getModel("low")).toBeUndefined();
    });

    it("returns an empty config when all sources return undefined", async () => {
      const loader = new CascadingConfigLoader({
        sources: [new FixedConfigSource(undefined), new DefaultConfigSource()],
      });
      const result = await loader.load();

      expect(result).toBeInstanceOf(FeatureForgeConfig);
      expect(result.models).toEqual({});
    });

    it("uses all three tiers with project > global > defaults", async () => {
      const project = new FeatureForgeConfig({
        models: { high: makeModel("project-high") },
      });
      const global = new FeatureForgeConfig({
        models: {
          high: makeModel("global-high"),
          medium: makeModel("global-medium"),
        },
      });
      const defaults = new FeatureForgeConfig({
        models: {
          high: makeModel("default-high"),
          medium: makeModel("default-medium"),
          low: makeModel("default-low"),
        },
      });
      const loader = new CascadingConfigLoader({
        sources: [
          new FixedConfigSource(project),
          new FixedConfigSource(global),
          new FixedConfigSource(defaults),
        ],
      });
      const result = await loader.load();

      expect(result.getModel("high")!.modelId).toBe("project-high");
      expect(result.getModel("medium")!.modelId).toBe("global-medium");
      expect(result.getModel("low")!.modelId).toBe("default-low");
    });
  });
});

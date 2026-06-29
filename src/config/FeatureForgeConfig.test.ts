import { describe, expect, it } from "vitest";

import { FeatureForgeConfig } from "./FeatureForgeConfig";
import { ModelConfig } from "./ModelConfig";

describe("FeatureForgeConfig", () => {
  describe("constructor", () => {
    it("stores the models map", () => {
      const high = new ModelConfig({ modelId: "sonnet", thinkingLevel: "high" });
      const config = new FeatureForgeConfig({ models: { high } });

      expect(config.getModel("high")).toBe(high);
      expect(config.getModel("medium")).toBeUndefined();
    });

    it("defaults to an empty models map", () => {
      const config = new FeatureForgeConfig();
      expect(config.models).toEqual({});
    });

    it("defaults to empty models when params is omitted entirely", () => {
      const config = new FeatureForgeConfig();
      expect(config.getModel("anything")).toBeUndefined();
    });
  });

  describe("getModel", () => {
    it("returns the matching ModelConfig for a known effort tier", () => {
      const medium = new ModelConfig({ modelId: "haiku", thinkingLevel: "medium" });
      const config = new FeatureForgeConfig({ models: { medium } });

      expect(config.getModel("medium")).toBe(medium);
    });

    it("returns undefined for an unknown effort tier", () => {
      const config = new FeatureForgeConfig();
      expect(config.getModel("404")).toBeUndefined();
    });
  });

  describe("equals", () => {
    it("returns true for identical configs", () => {
      const a = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "x", thinkingLevel: "high" }) },
      });
      const b = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "x", thinkingLevel: "high" }) },
      });
      expect(a.equals(b)).toBe(true);
    });

    it("returns true for two empty configs", () => {
      expect(new FeatureForgeConfig().equals(new FeatureForgeConfig())).toBe(true);
    });

    it("returns false when model keys differ", () => {
      const a = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "x" }) },
      });
      const b = new FeatureForgeConfig({
        models: { medium: new ModelConfig({ modelId: "x" }) },
      });
      expect(a.equals(b)).toBe(false);
    });

    it("returns false when model values differ for the same key", () => {
      const a = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "sonnet" }) },
      });
      const b = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "haiku" }) },
      });
      expect(a.equals(b)).toBe(false);
    });

    it("returns false for a different type", () => {
      const config = new FeatureForgeConfig();
      expect(config.equals({ models: {} })).toBe(false);
    });
  });

  describe("toString", () => {
    it("shows an empty config", () => {
      expect(new FeatureForgeConfig().toString()).toContain("(empty)");
    });

    it("shows model entries", () => {
      const config = new FeatureForgeConfig({
        models: { high: new ModelConfig({ modelId: "sonnet", thinkingLevel: "high" }) },
      });
      expect(config.toString()).toContain("high:");
      expect(config.toString()).toContain("sonnet");
    });
  });
});

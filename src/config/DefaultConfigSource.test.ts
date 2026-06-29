import { describe, expect, it } from "vitest";

import { DefaultConfigSource } from "./DefaultConfigSource";
import { FeatureForgeConfig } from "./FeatureForgeConfig";

describe("DefaultConfigSource", () => {
  describe("load", () => {
    it("returns an empty FeatureForgeConfig", async () => {
      const source = new DefaultConfigSource();
      const config = await source.load();

      expect(config).toBeInstanceOf(FeatureForgeConfig);
      expect(config.models).toEqual({});
      expect(config.getModel("anything")).toBeUndefined();
    });

    it("returns a new instance each time", async () => {
      const source = new DefaultConfigSource();
      const a = await source.load();
      const b = await source.load();

      expect(a).not.toBe(b);
      expect(a.equals(b)).toBe(true);
    });
  });
});

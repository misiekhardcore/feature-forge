import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FeatureForgeConfig } from "./FeatureForgeConfig";
import { FileConfigSource } from "./FileConfigSource";

describe("FileConfigSource", () => {
  const tmpDir = path.join(
    process.env.TMPDIR ?? "/tmp",
    `feature-forge-config-test-${process.pid}`,
  );
  let testFilePath: string;

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    testFilePath = path.join(tmpDir, "settings.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("returns undefined when the file does not exist", async () => {
      const source = new FileConfigSource(path.join(tmpDir, "nonexistent.json"));
      const config = await source.load();
      expect(config).toBeUndefined();
    });

    it("returns undefined when the file exists but has no feature-forge section", async () => {
      await fs.writeFile(testFilePath, JSON.stringify({ theme: "dark" }));
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();
      expect(config).toBeUndefined();
    });

    it("loads model configurations from a valid feature-forge section", async () => {
      await fs.writeFile(
        testFilePath,
        JSON.stringify({
          "feature-forge": {
            models: {
              high: { modelId: "sonnet", thinkingLevel: "high" },
              medium: { modelId: "haiku", thinkingLevel: "medium" },
            },
          },
        }),
      );
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();

      expect(config).toBeInstanceOf(FeatureForgeConfig);
      expect(config!.getModel("high")!.modelId).toBe("sonnet");
      expect(config!.getModel("high")!.thinkingLevel).toBe("high");
      expect(config!.getModel("medium")!.modelId).toBe("haiku");
      expect(config!.getModel("medium")!.thinkingLevel).toBe("medium");
    });

    it("allows omitting thinkingLevel", async () => {
      await fs.writeFile(
        testFilePath,
        JSON.stringify({
          "feature-forge": { models: { low: { modelId: "haiku" } } },
        }),
      );
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();

      expect(config!.getModel("low")!.modelId).toBe("haiku");
      expect(config!.getModel("low")!.thinkingLevel).toBeUndefined();
    });

    it("returns empty config when models key is missing", async () => {
      await fs.writeFile(testFilePath, JSON.stringify({ "feature-forge": {} }));
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();

      expect(config).toBeInstanceOf(FeatureForgeConfig);
      expect(config!.getModel("anything")).toBeUndefined();
    });

    it("returns undefined when feature-forge section has invalid schema", async () => {
      await fs.writeFile(
        testFilePath,
        JSON.stringify({
          "feature-forge": { models: { high: { modelId: "" } } },
        }),
      );
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();
      expect(config).toBeUndefined();
    });

    it("returns undefined when feature-forge section is not an object", async () => {
      await fs.writeFile(testFilePath, JSON.stringify({ "feature-forge": "not-an-object" }));
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();
      expect(config).toBeUndefined();
    });

    it("returns undefined for non-JSON content", async () => {
      await fs.writeFile(testFilePath, "not valid json");
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();
      expect(config).toBeUndefined();
    });

    it("returns undefined when root is not an object", async () => {
      await fs.writeFile(testFilePath, "[1, 2, 3]");
      const source = new FileConfigSource(testFilePath);
      const config = await source.load();
      expect(config).toBeUndefined();
    });
  });
});

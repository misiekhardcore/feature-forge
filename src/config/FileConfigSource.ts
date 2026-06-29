import * as fs from "node:fs/promises";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { ConfigSource } from "./ConfigSource";
import { FeatureForgeConfig } from "./FeatureForgeConfig";
import { ModelConfig } from "./ModelConfig";

/**
 * TypeBox schema for validating the `feature-forge` section inside Pi's
 * `settings.json` file.
 */
const ModelConfigSchema = Type.Object({
  modelId: Type.String({ minLength: 1 }),
  thinkingLevel: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
  ),
});

const FeatureForgeSectionSchema = Type.Object({
  models: Type.Optional(Type.Record(Type.String(), ModelConfigSchema)),
});

/**
 * A {@link ConfigSource} that reads a Pi `settings.json` file and extracts
 * the `"feature-forge"` section.
 *
 * The file is expected to be a JSON object. If it contains a
 * `"feature-forge"` key, that value is validated against the TypeBox schema.
 * Unknown or invalid entries are logged and skipped.
 */
export class FileConfigSource extends ConfigSource {
  constructor(private readonly filePath: string) {
    super();
  }

  public override async load(): Promise<FeatureForgeConfig | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf-8");
    } catch {
      // File doesn't exist or is unreadable — not an error, just no contribution.
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }

    if (parsed === null || typeof parsed !== "object") {
      return undefined;
    }

    return this.extractFeatureForge(parsed as Record<string, unknown>);
  }

  private extractFeatureForge(root: Record<string, unknown>): FeatureForgeConfig | undefined {
    const section = root["feature-forge"];
    if (section === undefined) {
      return undefined;
    }

    if (!Value.Check(FeatureForgeSectionSchema, section)) {
      return undefined;
    }

    const typed = section as {
      models?: Record<string, { modelId: string; thinkingLevel?: string }>;
    };
    if (!typed.models) {
      return new FeatureForgeConfig();
    }

    const models: Record<string, ModelConfig> = {};
    for (const [effort, model] of Object.entries(typed.models)) {
      models[effort] = new ModelConfig({
        modelId: model.modelId,
        thinkingLevel: model.thinkingLevel as "off" | "low" | "medium" | "high" | undefined,
      });
    }

    return new FeatureForgeConfig({ models });
  }
}

import { describe, expect, it } from "vitest";

import type { AgentModelConfig } from "./ForgeConfigSchema";
import { resolveModel } from "./ModelResolver";

describe("resolveModel", () => {
  it("returns undefined when rawModel is undefined", () => {
    const models: Record<string, AgentModelConfig> = {
      smart: { model: "claude-sonnet-4-5", provider: "anthropic" },
    };
    expect(resolveModel(undefined, models)).toBeUndefined();
  });

  it("resolves known alias to preset config with provider", () => {
    const models: Record<string, AgentModelConfig> = {
      smart: { model: "claude-sonnet-4-5", provider: "anthropic" },
    };
    expect(resolveModel("smart", models)).toEqual({
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      resolved: true,
    });
  });

  it("resolves known alias to preset config without provider", () => {
    const models: Record<string, AgentModelConfig> = {
      medium: { model: "claude-sonnet-4-5" },
    };
    expect(resolveModel("medium", models)).toEqual({ model: "claude-sonnet-4-5", resolved: true });
  });

  it("treats unknown string as raw model name (passthrough)", () => {
    const models: Record<string, AgentModelConfig> = {
      smart: { model: "claude-sonnet-4-5", provider: "anthropic" },
    };
    expect(resolveModel("gpt-4o", models)).toEqual({ model: "gpt-4o", resolved: false });
  });

  it("treats empty string as raw model name (passthrough)", () => {
    const models: Record<string, AgentModelConfig> = {
      smart: { model: "claude-sonnet-4-5", provider: "anthropic" },
    };
    expect(resolveModel("", models)).toEqual({ model: "", resolved: false });
  });

  it("works with empty models map (always passthrough)", () => {
    const models: Record<string, AgentModelConfig> = {};
    expect(resolveModel("any-model", models)).toEqual({ model: "any-model", resolved: false });
  });

  // Regression: the `in` operator walks the prototype chain, so preset
  // names that collide with Object.prototype keys used to "resolve" to a
  // config without a `model` field, violating ResolvedModelConfig.
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
    "never resolves prototype-chain key %s as a preset",
    (key) => {
      const models: Record<string, AgentModelConfig> = {
        smart: { model: "claude-sonnet-4-5", provider: "anthropic" },
      };
      const result = resolveModel(key, models);
      expect(result).toEqual({ model: key, resolved: false });
    },
  );

  it("resolves a preset that shadows a prototype key when it is an own property", () => {
    // An own "constructor" preset must still resolve normally.
    const models: Record<string, AgentModelConfig> = {
      constructor: { model: "claude-sonnet-4-5" },
    };
    expect(resolveModel("constructor", models)).toEqual({
      model: "claude-sonnet-4-5",
      resolved: true,
    });
  });
});

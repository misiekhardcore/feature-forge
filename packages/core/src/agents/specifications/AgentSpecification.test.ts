import { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { AgentSpecification } from "./AgentSpecification";
import { DynamicAgentSpecification } from "./DynamicAgentSpecification";

class TestSpecification extends AgentSpecification {
  constructor(overrides: Partial<ConstructorParameters<typeof AgentSpecification>[0]> = {}) {
    super({
      id: "test",
      role: "tester",
      systemPrompt: "You are a test agent.",
      ...overrides,
    });
  }
}

describe("AgentSpecification", () => {
  it("stores required fields", () => {
    const spec = new TestSpecification();
    expect(spec.id).toBe("test");
    expect(spec.role).toBe("tester");
    expect(spec.systemPrompt).toBe("You are a test agent.");
  });

  describe("defaults", () => {
    it("tools defaults to empty array", () => {
      const spec = new TestSpecification();
      expect(spec.tools).toEqual([]);
    });

    it("excludedTools defaults to empty array", () => {
      const spec = new TestSpecification();
      expect(spec.excludedTools).toEqual([]);
    });

    it("model defaults to undefined", () => {
      const spec = new TestSpecification();
      expect(spec.model).toBeUndefined();
    });

    it("thinkingLevel defaults to undefined", () => {
      const spec = new TestSpecification();
      expect(spec.thinkingLevel).toBeUndefined();
    });

    it("disableBuiltinTools defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.disableBuiltinTools).toBe(false);
    });

    it("disableExtensions defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.disableExtensions).toBe(false);
    });

    it("disableSkills defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.disableSkills).toBe(false);
    });

    it("disablePromptTemplates defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.disablePromptTemplates).toBe(false);
    });

    it("disableContextFiles defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.disableContextFiles).toBe(false);
    });

    it("ephemeral defaults to false", () => {
      const spec = new TestSpecification();
      expect(spec.ephemeral).toBe(false);
    });
  });

  describe("overrides", () => {
    it("accepts toolRestrictions override", () => {
      const spec = new TestSpecification({ toolRestrictions: { read: [], grep: [] } });
      expect(spec.tools).toEqual(["read", "grep"]);
    });

    it("accepts excludedTools override", () => {
      const spec = new TestSpecification({ excludedTools: ["bash"] });
      expect(spec.excludedTools).toEqual(["bash"]);
    });

    it("accepts model override", () => {
      const spec = new TestSpecification({ model: "claude-sonnet-4-5" });
      expect(spec.model).toBe("claude-sonnet-4-5");
    });

    it("accepts thinkingLevel override", () => {
      const spec = new TestSpecification({ thinkingLevel: "high" as ThinkingLevel });
      expect(spec.thinkingLevel).toBe("high");
    });

    it("accepts boolean overrides", () => {
      const spec = new TestSpecification({
        disableBuiltinTools: true,
        disableExtensions: true,
        disableSkills: true,
        disablePromptTemplates: true,
        disableContextFiles: true,
        ephemeral: true,
      });
      expect(spec.disableBuiltinTools).toBe(true);
      expect(spec.disableExtensions).toBe(true);
      expect(spec.disableSkills).toBe(true);
      expect(spec.disablePromptTemplates).toBe(true);
      expect(spec.disableContextFiles).toBe(true);
      expect(spec.ephemeral).toBe(true);
    });
  });

  describe("parseExcludedTools", () => {
    it("returns empty result for an empty array", () => {
      const parsed = AgentSpecification.parseExcludedTools([]);
      expect(parsed.fullExclusions.size).toBe(0);
      expect(parsed.partialRestrictions).toEqual({});
    });

    it("treats entries without a colon as full exclusions", () => {
      const parsed = AgentSpecification.parseExcludedTools(["write", "edit"]);
      expect(parsed.fullExclusions).toEqual(new Set(["write", "edit"]));
      expect(parsed.partialRestrictions).toEqual({});
    });

    it("treats entries with a colon as partial restrictions", () => {
      const parsed = AgentSpecification.parseExcludedTools(["bash:rm *", "bash:npm *"]);
      expect(parsed.fullExclusions.size).toBe(0);
      expect(parsed.partialRestrictions).toEqual({ bash: ["rm *", "npm *"] });
    });

    it("handles a mix of full exclusions and partial restrictions", () => {
      const parsed = AgentSpecification.parseExcludedTools(["write", "bash:rm *"]);
      expect(parsed.fullExclusions).toEqual(new Set(["write"]));
      expect(parsed.partialRestrictions).toEqual({ bash: ["rm *"] });
    });
  });

  describe("toJSON", () => {
    it("serializes all fields to a plain object", () => {
      const spec = new TestSpecification({
        model: "claude-sonnet-4-5",
        thinkingLevel: "high" as ThinkingLevel,
        toolRestrictions: { read: [] },
        cwd: "/tmp",
      });
      const json = spec.toJSON();
      expect(json.id).toBe("test");
      expect(json.role).toBe("tester");
      expect(json.systemPrompt).toBe("You are a test agent.");
      expect(json.model).toBe("claude-sonnet-4-5");
      expect(json.thinkingLevel).toBe("high");
      expect(json.cwd).toBe("/tmp");
    });

    it("roundtrips through DynamicAgentSpecification", () => {
      const original = new TestSpecification({
        model: "gpt-4o",
        thinkingLevel: "low" as ThinkingLevel,
      });
      const cloned = new DynamicAgentSpecification(original.toJSON());
      expect(cloned.id).toBe(original.id);
      expect(cloned.model).toBe(original.model);
      expect(cloned.thinkingLevel).toBe(original.thinkingLevel);
    });
  });
});

import { describe, expect, it } from "vitest";

import { AgentSpecification, ThinkingLevel } from "./AgentSpecification";

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
    it("toolNames defaults to empty array", () => {
      const spec = new TestSpecification();
      expect(spec.toolNames).toEqual([]);
    });

    it("excludeToolNames defaults to empty array", () => {
      const spec = new TestSpecification();
      expect(spec.excludeToolNames).toEqual([]);
    });

    it("modelPreference defaults to undefined", () => {
      const spec = new TestSpecification();
      expect(spec.modelPreference).toBeUndefined();
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
    it("accepts toolNames override", () => {
      const spec = new TestSpecification({ toolNames: ["read", "grep"] });
      expect(spec.toolNames).toEqual(["read", "grep"]);
    });

    it("accepts excludeToolNames override", () => {
      const spec = new TestSpecification({ excludeToolNames: ["bash"] });
      expect(spec.excludeToolNames).toEqual(["bash"]);
    });

    it("accepts modelPreference override", () => {
      const spec = new TestSpecification({ modelPreference: "claude-sonnet-4-5" });
      expect(spec.modelPreference).toBe("claude-sonnet-4-5");
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
});

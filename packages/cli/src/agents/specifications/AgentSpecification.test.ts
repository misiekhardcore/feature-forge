import { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { AgentSpecification } from "./AgentSpecification";

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
    it("accepts tools override", () => {
      const spec = new TestSpecification({ tools: ["read", "grep"] });
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

    it("bashAllowlist defaults to empty array", () => {
      const spec = new TestSpecification();
      expect(spec.bashAllowlist).toEqual([]);
    });

    it("accepts bashAllowlist override", () => {
      const spec = new TestSpecification({
        bashAllowlist: ["npm run test", "npx vitest run"],
      });
      expect(spec.bashAllowlist).toEqual(["npm run test", "npx vitest run"]);
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

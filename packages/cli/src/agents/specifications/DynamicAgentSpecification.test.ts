import { describe, expect, it } from "vitest";

import { DynamicAgentSpecification } from "./DynamicAgentSpecification";

describe("DynamicAgentSpecification", () => {
  describe("toolRestrictions passthrough", () => {
    it("passes toolRestrictions through to the base AgentSpecification", () => {
      const spec = new DynamicAgentSpecification({
        role: "test",
        systemPrompt: "You are a test agent.",
        tools: ["read", "bash"],
        toolRestrictions: { bash: ["restricted/*"] },
      });

      expect(spec.toolRestrictions).toEqual({ bash: ["restricted/*"] });
      expect(spec.tools).toEqual(["read", "bash"]);
    });

    it("defaults toolRestrictions to empty object when not provided", () => {
      const spec = new DynamicAgentSpecification({
        role: "test",
        systemPrompt: "You are a test agent.",
        tools: ["read", "bash"],
      });

      expect(spec.toolRestrictions).toEqual({});
    });
  });

  describe("generateId", () => {
    it("generates an id from the role", () => {
      const id = DynamicAgentSpecification.generateId({ role: "build" });
      expect(id).toMatch(/^build-[a-z0-9]+$/);
    });
  });

  describe("id override", () => {
    it("uses provided id when given", () => {
      const spec = new DynamicAgentSpecification({
        id: "custom-id",
        role: "test",
        systemPrompt: "Test",
      });
      expect(spec.id).toBe("custom-id");
    });

    it("generates id when not provided", () => {
      const spec = new DynamicAgentSpecification({
        role: "builder",
        systemPrompt: "Test",
      });
      expect(spec.id).toMatch(/^builder-/);
    });
  });

  describe("toJSON", () => {
    it("serializes all fields to a plain object", () => {
      const spec = new DynamicAgentSpecification({
        id: "json-test",
        role: "json-role",
        systemPrompt: "JSON test",
        tools: ["read", "bash"],
        excludedTools: ["write"],
        toolRestrictions: { bash: ["git *"] },
        thinkingLevel: "high",
        disableBuiltinTools: true,
        ephemeral: true,
      });

      const json = spec.toJSON();

      expect(json).toEqual({
        id: "json-test",
        role: "json-role",
        systemPrompt: "JSON test",
        tools: ["read", "bash"],
        excludedTools: ["write"],
        toolRestrictions: { bash: ["git *"] },
        model: undefined,
        thinkingLevel: "high",
        disableBuiltinTools: true,
        disableExtensions: false,
        disableSkills: false,
        disablePromptTemplates: false,
        disableContextFiles: false,
        ephemeral: true,
        cwd: undefined,
      });
    });

    it("round-trips through JSON.stringify and fromJSON", () => {
      const original = new DynamicAgentSpecification({
        id: "round-trip",
        role: "round-trip-role",
        systemPrompt: "Round trip test",
        tools: ["read", "grep", "ls", "bash"],
        excludedTools: [],
        toolRestrictions: { bash: ["git *", "npm *"], write: ["src/*"] },
        thinkingLevel: "medium",
        ephemeral: true,
      });

      const serialized = JSON.stringify(original);
      const restored = DynamicAgentSpecification.fromJSON(serialized);

      expect(restored.id).toBe(original.id);
      expect(restored.role).toBe(original.role);
      expect(restored.systemPrompt).toBe(original.systemPrompt);
      expect(restored.tools).toEqual(original.tools);
      expect(restored.excludedTools).toEqual(original.excludedTools);
      expect(restored.toolRestrictions).toEqual(original.toolRestrictions);
      expect(restored.thinkingLevel).toBe(original.thinkingLevel);
      expect(restored.ephemeral).toBe(original.ephemeral);
    });
  });

  describe("fromJSON", () => {
    it("deserializes a valid JSON spec string", () => {
      const json = JSON.stringify({
        role: "from-json",
        systemPrompt: "From JSON test",
        tools: ["read", "bash"],
        toolRestrictions: { bash: ["git *"] },
      });

      const spec = DynamicAgentSpecification.fromJSON(json);

      expect(spec.role).toBe("from-json");
      expect(spec.systemPrompt).toBe("From JSON test");
      expect(spec.tools).toEqual(["read", "bash"]);
      expect(spec.toolRestrictions).toEqual({ bash: ["git *"] });
    });

    it("throws on invalid JSON", () => {
      expect(() => DynamicAgentSpecification.fromJSON("{invalid")).toThrow();
    });

    it("throws on non-object JSON", () => {
      expect(() => DynamicAgentSpecification.fromJSON('"string"')).toThrow(
        "FORGE_SPEC must be a JSON object",
      );
    });

    it("throws on null", () => {
      expect(() => DynamicAgentSpecification.fromJSON("null")).toThrow(
        "FORGE_SPEC must be a JSON object",
      );
    });
  });
});

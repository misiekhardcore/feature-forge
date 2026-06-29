import { describe, expect, it } from "vitest";

import { ModelConfig } from "./ModelConfig";

describe("ModelConfig", () => {
  describe("constructor", () => {
    it("stores the modelId and thinkingLevel", () => {
      const config = new ModelConfig({ modelId: "claude-sonnet", thinkingLevel: "high" });
      expect(config.modelId).toBe("claude-sonnet");
      expect(config.thinkingLevel).toBe("high");
    });

    it("allows thinkingLevel to be omitted", () => {
      const config = new ModelConfig({ modelId: "gpt-4o" });
      expect(config.modelId).toBe("gpt-4o");
      expect(config.thinkingLevel).toBeUndefined();
    });

    it("throws when modelId is empty", () => {
      expect(() => new ModelConfig({ modelId: "" })).toThrow("modelId must not be empty");
    });

    it("throws when modelId is whitespace-only", () => {
      expect(() => new ModelConfig({ modelId: "   " })).toThrow("modelId must not be empty");
    });
  });

  describe("equals", () => {
    it("returns true for identical configs", () => {
      const a = new ModelConfig({ modelId: "c", thinkingLevel: "medium" });
      const b = new ModelConfig({ modelId: "c", thinkingLevel: "medium" });
      expect(a.equals(b)).toBe(true);
    });

    it("returns false when modelId differs", () => {
      const a = new ModelConfig({ modelId: "a" });
      const b = new ModelConfig({ modelId: "b" });
      expect(a.equals(b)).toBe(false);
    });

    it("returns false when thinkingLevel differs", () => {
      const a = new ModelConfig({ modelId: "x", thinkingLevel: "low" });
      const b = new ModelConfig({ modelId: "x", thinkingLevel: "high" });
      expect(a.equals(b)).toBe(false);
    });

    it("returns false when one has thinkingLevel and the other does not", () => {
      const a = new ModelConfig({ modelId: "x", thinkingLevel: "low" });
      const b = new ModelConfig({ modelId: "x" });
      expect(a.equals(b)).toBe(false);
    });

    it("returns false for a different type", () => {
      const a = new ModelConfig({ modelId: "x" });
      expect(a.equals({ modelId: "x" })).toBe(false);
    });
  });

  describe("toString", () => {
    it("includes modelId and thinkingLevel", () => {
      const config = new ModelConfig({ modelId: "gpt-5", thinkingLevel: "high" });
      expect(config.toString()).toContain("gpt-5");
      expect(config.toString()).toContain("high");
    });

    it('shows "default" when thinkingLevel is undefined', () => {
      const config = new ModelConfig({ modelId: "gpt-5" });
      expect(config.toString()).toContain("thinkingLevel=default");
    });
  });
});

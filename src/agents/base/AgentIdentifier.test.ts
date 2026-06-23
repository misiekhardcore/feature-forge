import { describe, expect, it } from "vitest";

import { AgentIdentifier } from "./AgentIdentifier";

describe("AgentIdentifier", () => {
  describe("constructor", () => {
    it("creates an identifier with a valid string", () => {
      const id = new AgentIdentifier("researcher-1");
      expect(id.value).toBe("researcher-1");
    });

    it("trims whitespace but rejects empty after trim", () => {
      expect(() => new AgentIdentifier("")).toThrow("AgentIdentifier must not be empty");
      expect(() => new AgentIdentifier("   ")).toThrow("AgentIdentifier must not be empty");
    });

    it("accepts strings with spaces in the middle", () => {
      const id = new AgentIdentifier("my agent");
      expect(id.value).toBe("my agent");
    });
  });

  describe("equals", () => {
    it("returns true for equal identifiers", () => {
      const a = new AgentIdentifier("foo");
      const b = new AgentIdentifier("foo");
      expect(a.equals(b)).toBe(true);
    });

    it("returns false for different identifiers", () => {
      const a = new AgentIdentifier("foo");
      const b = new AgentIdentifier("bar");
      expect(a.equals(b)).toBe(false);
    });

    it("is reflexive", () => {
      const a = new AgentIdentifier("x");
      expect(a.equals(a)).toBe(true);
    });
  });

  describe("toString", () => {
    it("returns the identifier value", () => {
      const id = new AgentIdentifier("hello");
      expect(id.toString()).toBe("hello");
    });
  });
});

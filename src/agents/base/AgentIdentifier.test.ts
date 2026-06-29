import { describe, expect, it } from "vitest";

import { AgentIdentifier } from "./AgentIdentifier";

describe("AgentIdentifier", () => {
  describe("constructor", () => {
    it("creates an identifier with a valid string", () => {
      const identifier = new AgentIdentifier({ id: "researcher" });

      expect(identifier.id).toBe("researcher");
    });

    it("trims whitespace from the id", () => {
      const identifier = new AgentIdentifier({ id: "  build  " });

      expect(identifier.id).toBe("build");
    });

    it("throws when id is an empty string", () => {
      expect(() => new AgentIdentifier({ id: "" })).toThrow("AgentIdentifier id must not be empty");
    });

    it("throws when id is whitespace-only", () => {
      expect(() => new AgentIdentifier({ id: "   " })).toThrow(
        "AgentIdentifier id must not be empty",
      );
    });
  });

  describe("toString", () => {
    it("returns the identifier string", () => {
      const identifier = new AgentIdentifier({ id: "review" });

      expect(identifier.toString()).toBe("review");
    });

    it("works with special characters", () => {
      const identifier = new AgentIdentifier({ id: "agent-01_test" });

      expect(identifier.toString()).toBe("agent-01_test");
    });
  });

  describe("equals", () => {
    it("returns true for identifiers with the same id", () => {
      const alpha = new AgentIdentifier({ id: "verify" });
      const beta = new AgentIdentifier({ id: "verify" });

      expect(alpha.equals(beta)).toBe(true);
    });

    it("returns false for identifiers with different ids", () => {
      const alpha = new AgentIdentifier({ id: "build" });
      const beta = new AgentIdentifier({ id: "review" });

      expect(alpha.equals(beta)).toBe(false);
    });

    it("returns true when comparing an identifier to itself", () => {
      const identifier = new AgentIdentifier({ id: "self" });

      expect(identifier.equals(identifier)).toBe(true);
    });
  });
});

import { describe, expect, it } from "vitest";

import { resolveEffectiveNames } from "./skill-resolver";

describe("resolveEffectiveNames", () => {
  const allSkills = new Map([
    ["build", "/path/build/SKILL.md"],
    ["review", "/path/review/SKILL.md"],
    ["verify", "/path/verify/SKILL.md"],
    ["research", "/path/research/SKILL.md"],
  ]);

  describe("effective-set logic", () => {
    it("returns all discovered skills when both skills and excludedSkills are empty", () => {
      const result = resolveEffectiveNames(allSkills, [], []);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });

    it("returns only allowlisted skills when skills is non-empty", () => {
      const result = resolveEffectiveNames(allSkills, ["build", "review"], []);
      expect(result).toEqual(["build", "review"]);
    });

    it("excludes excludedSkills from the allowlist", () => {
      const result = resolveEffectiveNames(allSkills, ["build", "review", "verify"], ["review"]);
      expect(result).toEqual(["build", "verify"]);
    });

    it("excludes excludedSkills from all discovered skills when skills is empty", () => {
      const result = resolveEffectiveNames(allSkills, [], ["build", "research"]);
      expect(result).toEqual(["review", "verify"]);
    });

    it("returns empty array when all skills are excluded", () => {
      const result = resolveEffectiveNames(allSkills, ["build", "review"], ["build", "review"]);
      expect(result).toEqual([]);
    });

    it("excludedSkills overrides skills even when both are specified", () => {
      const result = resolveEffectiveNames(
        allSkills,
        ["build", "review", "verify", "research"],
        ["build", "research"],
      );
      expect(result).toEqual(["review", "verify"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty when allSkills is empty even if skills are specified", () => {
      const result = resolveEffectiveNames(new Map(), ["build"], []);
      expect(result).toEqual([]);
    });

    it("returns empty when skills is non-empty but none are in the map", () => {
      const result = resolveEffectiveNames(allSkills, ["unknown-skill"], []);
      expect(result).toEqual([]);
    });

    it("ignores excludedSkills that are not in skills or discovered set", () => {
      const result = resolveEffectiveNames(allSkills, ["build", "review"], ["does-not-exist"]);
      expect(result).toEqual(["build", "review"]);
    });

    it("handles empty skills with non-empty excludedSkills that don't overlap", () => {
      const result = resolveEffectiveNames(allSkills, [], ["does-not-exist"]);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });
  });
});

import * as fs from "node:fs";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { SkillResolver } from "./skill-resolver";

describe("SkillResolver.resolveEffectiveNames", () => {
  const allSkills = new Map([
    ["build", "/path/build/SKILL.md"],
    ["review", "/path/review/SKILL.md"],
    ["verify", "/path/verify/SKILL.md"],
    ["research", "/path/research/SKILL.md"],
  ]);

  describe("effective-set logic", () => {
    it("returns all discovered skills when both skills and excludedSkills are empty", () => {
      const result = SkillResolver.resolveEffectiveNames(allSkills, [], []);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });

    it("returns only allowlisted skills when skills is non-empty", () => {
      const result = SkillResolver.resolveEffectiveNames(allSkills, ["build", "review"], []);
      expect(result).toEqual(["build", "review"]);
    });

    it("excludes excludedSkills from the allowlist", () => {
      const result = SkillResolver.resolveEffectiveNames(
        allSkills,
        ["build", "review", "verify"],
        ["review"],
      );
      expect(result).toEqual(["build", "verify"]);
    });

    it("excludes excludedSkills from all discovered skills when skills is empty", () => {
      const result = SkillResolver.resolveEffectiveNames(allSkills, [], ["build", "research"]);
      expect(result).toEqual(["review", "verify"]);
    });

    it("returns empty array when all skills are excluded", () => {
      const result = SkillResolver.resolveEffectiveNames(
        allSkills,
        ["build", "review"],
        ["build", "review"],
      );
      expect(result).toEqual([]);
    });

    it("excludedSkills overrides skills even when both are specified", () => {
      const result = SkillResolver.resolveEffectiveNames(
        allSkills,
        ["build", "review", "verify", "research"],
        ["build", "research"],
      );
      expect(result).toEqual(["review", "verify"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty when allSkills is empty even if skills are specified", () => {
      const result = SkillResolver.resolveEffectiveNames(new Map(), ["build"], []);
      expect(result).toEqual([]);
    });

    it("returns empty when skills is non-empty but none are in the map", () => {
      const result = SkillResolver.resolveEffectiveNames(allSkills, ["unknown-skill"], []);
      expect(result).toEqual([]);
    });

    it("ignores excludedSkills that are not in skills or discovered set", () => {
      const result = SkillResolver.resolveEffectiveNames(
        allSkills,
        ["build", "review"],
        ["does-not-exist"],
      );
      expect(result).toEqual(["build", "review"]);
    });

    it("handles empty skills with non-empty excludedSkills that don't overlap", () => {
      const result = SkillResolver.resolveEffectiveNames(allSkills, [], ["does-not-exist"]);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });
  });
});

describe("SkillResolver project skill discovery", () => {
  it("discovers forge-build skill from .forge/skills/forge-build/SKILL.md", () => {
    const buildSkillPath = path.resolve(
      process.cwd(),
      ".forge",
      "skills",
      "forge-build",
      "SKILL.md",
    );
    expect(fs.existsSync(buildSkillPath)).toBe(true);

    const content = fs.readFileSync(buildSkillPath, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.name).toBe("forge-build");
    expect(frontmatter.description).toBeDefined();
  });

  it("discovers forge-build skill via discoverAll when CWD is project root", () => {
    const originalCwd = process.cwd();
    const projectRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
    try {
      process.chdir(projectRoot);
      const allSkills = SkillResolver.discoverAll();
      expect(allSkills.has("forge-build")).toBe(true);
      expect(allSkills.get("forge-build")).toContain("SKILL.md");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

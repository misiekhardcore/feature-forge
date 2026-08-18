import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { SkillResolver } from "./skill-resolver";

describe("SkillResolver.resolveEffectiveSkillNames", () => {
  const allSkills = new Map([
    ["build", "/path/build/SKILL.md"],
    ["review", "/path/review/SKILL.md"],
    ["verify", "/path/verify/SKILL.md"],
    ["research", "/path/research/SKILL.md"],
  ]);

  describe("effective-set logic", () => {
    it("returns all discovered skills when both skills and excludedSkills are empty", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(allSkills, [], []);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });

    it("returns only allowlisted skills when skills is non-empty", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(allSkills, ["build", "review"], []);
      expect(result).toEqual(["build", "review"]);
    });

    it("excludes excludedSkills from the allowlist", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(
        allSkills,
        ["build", "review", "verify"],
        ["review"],
      );
      expect(result).toEqual(["build", "verify"]);
    });

    it("excludes excludedSkills from all discovered skills when skills is empty", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(allSkills, [], ["build", "research"]);
      expect(result).toEqual(["review", "verify"]);
    });

    it("returns empty array when all skills are excluded", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(
        allSkills,
        ["build", "review"],
        ["build", "review"],
      );
      expect(result).toEqual([]);
    });

    it("excludedSkills overrides skills even when both are specified", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(
        allSkills,
        ["build", "review", "verify", "research"],
        ["build", "research"],
      );
      expect(result).toEqual(["review", "verify"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty when allSkills is empty even if skills are specified", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(new Map(), ["build"], []);
      expect(result).toEqual([]);
    });

    it("returns empty when skills is non-empty but none are in the map", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(allSkills, ["unknown-skill"], []);
      expect(result).toEqual([]);
    });

    it("ignores excludedSkills that are not in skills or discovered set", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(
        allSkills,
        ["build", "review"],
        ["does-not-exist"],
      );
      expect(result).toEqual(["build", "review"]);
    });

    it("handles empty skills with non-empty excludedSkills that don't overlap", () => {
      const result = SkillResolver.resolveEffectiveSkillNames(allSkills, [], ["does-not-exist"]);
      expect(result).toEqual(["build", "review", "verify", "research"]);
    });
  });
});

describe("skill discovery", () => {
  it("discovers forge-build skill from the bundled skills dir", () => {
    // Bundled skills still ship from packages/cli/src/skills until S4b moves
    // them to core/src/skills (where skill-resolver already scans for them).
    const buildSkillPath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "cli",
      "src",
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

  it("discovers forge-build skill via SkillResolver.discoverAllSkills when CWD has .forge/skills", () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-test-"));
    try {
      const skillDir = path.join(tempDir, ".forge", "skills", "forge-build");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: forge-build\ndescription: test\n---\n",
      );

      process.chdir(tempDir);
      const allSkills = SkillResolver.discoverAllSkills();
      expect(allSkills.has("forge-build")).toBe(true);
      expect(allSkills.get("forge-build")).toContain("SKILL.md");
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Bundled skills land in core/src/skills in S4b; until then the resolver's
  // bundled directories (core/src/skills) are empty, so the bundled-discovery
  // assertion cannot hold. Re-enable when skills move.
  it.skip("discovers bundled forge-build skill without a project .forge/skills dir", () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-bundled-"));
    try {
      process.chdir(tempDir);
      const allSkills = SkillResolver.discoverAllSkills();
      expect(allSkills.has("forge-build")).toBe(true);
      expect(allSkills.get("forge-build")).toContain("SKILL.md");
      expect(allSkills.get("forge-build")).toMatch(/[\\/]skills[\\/]forge-build[\\/]SKILL[.]md$/);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("discovers single-file .md skills from ~/.pi/agent/skills", () => {
    const originalCwd = process.cwd();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-pi-skills-"));
    const homeDir = path.join(tempDir, "home");
    try {
      const piSkillsDir = path.join(homeDir, ".pi", "agent", "skills");
      fs.mkdirSync(piSkillsDir, { recursive: true });
      // A nested SKILL.md (directory-form skill) plus single-file skills.
      fs.mkdirSync(path.join(piSkillsDir, "nested-skill"));
      fs.writeFileSync(path.join(piSkillsDir, "nested-skill", "SKILL.md"), "# nested\n");
      fs.writeFileSync(path.join(piSkillsDir, "single-skill.md"), "# single\n");
      // SKILL.md at the root is not a skill definition itself.
      fs.writeFileSync(path.join(piSkillsDir, "SKILL.md"), "# root\n");
      process.chdir(tempDir);
      const originalHome = process.env.HOME;
      process.env.HOME = homeDir;
      try {
        const allSkills = SkillResolver.discoverAllSkills();
        expect(allSkills.has("nested-skill")).toBe(true);
        expect(allSkills.has("single-skill")).toBe(true);
        expect(allSkills.get("single-skill")).toBe(path.join(piSkillsDir, "single-skill.md"));
        expect(allSkills.has("SKILL")).toBe(false);
      } finally {
        process.env.HOME = originalHome;
      }
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

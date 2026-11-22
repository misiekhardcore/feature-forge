import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

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
    const buildSkillPath = path.resolve(__dirname, "..", "..", "skills", "forge-build", "SKILL.md");
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

  it("discovers bundled forge-build skill without a project .forge/skills dir", () => {
    // Isolate HOME so a user-installed forge-build in ~/.agents/skills or
    // ~/.pi/agent/skills cannot mask a broken bundled-discovery path.
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-bundled-"));
    const homeDir = path.join(tempDir, "home");
    try {
      process.chdir(tempDir);
      process.env.HOME = homeDir;
      const allSkills = SkillResolver.discoverAllSkills();
      expect(allSkills.has("forge-build")).toBe(true);
      expect(allSkills.get("forge-build")).toContain("SKILL.md");
      expect(allSkills.get("forge-build")).toMatch(/[\\/]skills[\\/]forge-build[\\/]SKILL[.]md$/);
    } finally {
      process.env.HOME = originalHome;
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("discovers bundled skills nested in grouping directories (the review/* family)", () => {
    // The bundled skills tree groups the review skills under review/* (a
    // grouping dir with no direct SKILL.md). A one-level scan silently
    // dropped the whole family, so pin that nested skill roots resolve
    // from the packaged layer at any depth.
    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-nested-"));
    const homeDir = path.join(tempDir, "home");
    try {
      process.chdir(tempDir);
      process.env.HOME = homeDir;
      const allSkills = SkillResolver.discoverAllSkills();
      expect(allSkills.has("review-architecture")).toBe(true);
      expect(allSkills.has("review-security")).toBe(true);
      expect(allSkills.get("review-architecture")).toMatch(
        /[\\/]skills[\\/]review[\\/]architecture[\\/]SKILL[.]md$/,
      );
    } finally {
      process.env.HOME = originalHome;
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

describe("forge homes cascade", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  /**
   * Write a skill into `<home>/skills/<dir>`; returns the expected
   * SKILL.md path. Isolates HOME to a stub under the temp dir so the real
   * ~/.agents/skills / ~/.pi/agent/skills cannot interfere.
   */
  function writeHomeSkill(homeDir: string, name: string): string {
    const skillDir = path.join(homeDir, "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: test\n---\n`,
    );
    return path.join(skillDir, "SKILL.md");
  }

  function makeTempHomes(): { tempDir: string; projectHome: string; globalHome: string } {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-resolver-homes-"));
    process.env.HOME = path.join(tempDir, "home");
    return {
      tempDir,
      projectHome: path.join(tempDir, "project"),
      globalHome: path.join(tempDir, "global"),
    };
  }

  it("lets the first (project) home win when a skill name exists in both homes", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      const projectCopy = writeHomeSkill(projectHome, "shared");
      writeHomeSkill(globalHome, "shared");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("shared")).toBe(projectCopy);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves a skill present only in the second (global) home", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      const globalCopy = writeHomeSkill(globalHome, "global-only");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("global-only")).toBe(globalCopy);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips homes whose skills directory does not exist", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // projectHome/skills is never scaffolded; globalHome holds the skill.
      const globalCopy = writeHomeSkill(globalHome, "only-skill");

      // Scanning the missing project home contributes nothing, not an error.
      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("only-skill")).toBe(globalCopy);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to the bundled skills when neither home declares the name", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // Both homes are scaffolded but hold unrelated skills only.
      writeHomeSkill(projectHome, "project-only");
      writeHomeSkill(globalHome, "global-only");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      // forge-build ships in the bundled defaults, so it still resolves.
      expect(allSkills.has("forge-build")).toBe(true);
      expect(allSkills.get("forge-build")).toMatch(/[\\/]skills[\\/]forge-build[\\/]SKILL[.]md$/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("discovers skills nested in grouping directories within a home", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // A grouping directory (no direct SKILL.md) holds skills one level
      // deeper, mirroring the bundled review/* layout in scaffolded homes.
      const nestedPath = path.join(projectHome, "skills", "review", "architecture", "SKILL.md");
      fs.mkdirSync(path.dirname(nestedPath), { recursive: true });
      fs.writeFileSync(nestedPath, "---\nname: review-architecture\ndescription: test\n---\n");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("review-architecture")).toBe(nestedPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolveSkillPaths honors the nearest home for allowlisted names", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      const projectCopy = writeHomeSkill(projectHome, "shared");
      writeHomeSkill(globalHome, "shared");

      const paths = SkillResolver.resolveSkillPaths(["shared"], [], [projectHome, globalHome]);
      expect(paths).toEqual([projectCopy]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("follows a symlinked skill subdirectory into its target", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // The skill lives outside the home and is symlinked into the home's
      // skills root. A dirent for a symlink reports neither isDirectory
      // nor isFile, so the scan must statSync-follow it (pi's loader
      // does) or the skill is silently dropped. The resolved path is the
      // link path, not the resolved target.
      const externalDir = path.join(tempDir, "external", "linked-skill");
      fs.mkdirSync(externalDir, { recursive: true });
      fs.writeFileSync(
        path.join(externalDir, "SKILL.md"),
        "---\nname: linked-skill\ndescription: test\n---\n",
      );
      fs.mkdirSync(path.join(projectHome, "skills"), { recursive: true });
      fs.symlinkSync(externalDir, path.join(projectHome, "skills", "linked-skill"), "dir");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("linked-skill")).toBe(
        path.join(projectHome, "skills", "linked-skill", "SKILL.md"),
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("treats a symlinked SKILL.md inside a skill dir as a skill root", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // The skill content lives elsewhere; only SKILL.md is symlinked
      // into an otherwise empty dir. The dir is a skill root and resolves
      // through the link.
      const skillDir = path.join(projectHome, "skills", "file-linked-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      const contentFile = path.join(tempDir, "skill-content.md");
      fs.writeFileSync(contentFile, "---\nname: file-linked-skill\ndescription: test\n---\n");
      fs.symlinkSync(contentFile, path.join(skillDir, "SKILL.md"), "file");

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("file-linked-skill")).toBe(path.join(skillDir, "SKILL.md"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips broken symlinks without throwing", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      const realCopy = writeHomeSkill(projectHome, "real-skill");
      // A dir symlink to a missing target is skipped (statSync throws),
      // not an error.
      fs.symlinkSync(
        path.join(tempDir, "missing"),
        path.join(projectHome, "skills", "broken"),
        "dir",
      );

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.has("broken")).toBe(false);
      expect(allSkills.get("real-skill")).toBe(realCopy);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves same-named skills in one home deterministically (alphabetical first wins)", () => {
    const { tempDir, projectHome, globalHome } = makeTempHomes();
    try {
      // Created z-first so an unsorted readdir scan would likely return
      // the z copy first on common filesystems; the sorted scan always
      // pins the a copy as the winner.
      fs.mkdirSync(path.join(projectHome, "skills"), { recursive: true });
      for (const dirName of ["z-dup", "a-dup"]) {
        const skillDir = path.join(projectHome, "skills", dirName);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          "---\nname: dup-name\ndescription: test\n---\n",
        );
      }

      const allSkills = SkillResolver.discoverAllSkills([projectHome, globalHome]);
      expect(allSkills.get("dup-name")).toBe(path.join(projectHome, "skills", "a-dup", "SKILL.md"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("SkillResolver.resolveSkillName", () => {
  it("returns the frontmatter name when SKILL.md declares one", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-resolve-name-"));
    try {
      const skillDir = path.join(tempDir, "dir-name");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: frontmatter-name\ndescription: x\n---\n",
      );
      expect(SkillResolver.resolveSkillName(skillDir)).toBe("frontmatter-name");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to the directory basename when the frontmatter declares no name", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-resolve-name-"));
    try {
      const skillDir = path.join(tempDir, "dir-name");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\ndescription: x\n---\n");
      expect(SkillResolver.resolveSkillName(skillDir)).toBe("dir-name");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns null when SKILL.md is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-resolve-name-"));
    try {
      expect(SkillResolver.resolveSkillName(tempDir)).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

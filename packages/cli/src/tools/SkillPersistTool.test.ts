import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillPersistTool } from "./SkillPersistTool";

// Project-scope persistence and the metadata assertions never read the
// global home (only the `global` scope consults it, and those tests
// construct their own tool bound to a per-test global home, mirroring the
// composition root wiring `new SkillPersistTool(ForgeConfigPaths.resolveGlobalHome())`).
const tool = new SkillPersistTool("/forge-home-not-consulted");

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-persist-"));
}

/** Write a file at <root>/<rel>, creating parent directories. */
function write(root: string, rel: string, content: string): string {
  const filePath = path.join(root, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

/** Run git in a directory and return trimmed stdout. */
function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function makeRepo(): string {
  const repo = makeTempDir();
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "user.email", "test@forge.local"]);
  git(repo, ["config", "user.name", "Forge Test"]);
  write(repo, "README.md", "# repo\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function headHash(repo: string): string {
  return git(repo, ["log", "-1", "--format=%H"]);
}

/** Scaffold a valid source skill tree at <root>/<name>. */
function makeSourceSkill(root: string, name: string, frontmatterName = name): string {
  const skillDir = path.join(root, name);
  write(
    skillDir,
    "SKILL.md",
    `---\nname: ${frontmatterName}\ndescription: Test skill.\n---\n\n# ${name}\n`,
  );
  write(skillDir, "references/a.md", "# A\n");
  write(skillDir, "scripts/x.sh", "#!/bin/sh\necho ok\n");
  return skillDir;
}

/** Execute against a tool and return the result text. */
async function run(
  params: {
    path: string;
    scope: "project" | "global";
    confirmed?: boolean;
  },
  persistTool: SkillPersistTool = tool,
): Promise<string> {
  const result = await persistTool.execute("call-1", params, undefined);
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

const tempDirs: string[] = [];

function mockCwd(dir: string): void {
  vi.spyOn(process, "cwd").mockReturnValue(dir);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SkillPersistTool", () => {
  it("has name 'skill_persist'", () => {
    expect(tool.name).toBe("skill_persist");
  });

  it("has a label and a description", () => {
    expect(tool.label).toBe("Persist Skill");
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters requiring a path and a valid scope", () => {
    expect(Value.Check(tool.parameters, { path: "/tmp/skill", scope: "project" })).toBe(true);
    expect(Value.Check(tool.parameters, { path: "/tmp/skill", scope: "global" })).toBe(true);
    expect(
      Value.Check(tool.parameters, { path: "/tmp/skill", scope: "global", confirmed: true }),
    ).toBe(true);
    expect(Value.Check(tool.parameters, { path: "/tmp/skill", scope: "bogus" })).toBe(false);
    expect(Value.Check(tool.parameters, { path: "/tmp/skill" })).toBe(false);
  });

  describe("execute", () => {
    it("persists to <git root>/.pi/skills/<name> and stages files without committing", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);
      const headBefore = headHash(repo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, "references", "a.md"))).toBe(true);
      expect(text).toContain('[ok] skill "my-skill" persisted to project scope');
      expect(text).toContain(`Destination: ${destDir}`);
      expect(text).toContain("Git: staged 3 file(s): .pi/skills/my-skill/");
      expect(text).toContain("rides the current work's commit");

      const porcelain = git(repo, ["status", "--porcelain"]);
      expect(porcelain).toContain(".pi/skills/my-skill/SKILL.md");
      expect(porcelain).toContain(".pi/skills/my-skill/references/a.md");
      // No commit was executed: HEAD is unchanged and nothing is committed.
      expect(headHash(repo)).toBe(headBefore);
      expect(git(repo, ["log", "--oneline"]).split("\n").length).toBe(1);
    });

    it("skips files that already exist at the destination (extend-don't-clobber)", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      // Seed a tracked SKILL.md at the destination so the copy-skip path is
      // exercised against a file git already knows (no staged diff for it).
      write(repo, ".pi/skills/my-skill/SKILL.md", "OLD CONTENT\n");
      git(repo, ["add", ".pi/skills/my-skill"]);
      git(repo, ["commit", "-m", "seed skill"]);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe("OLD CONTENT\n");
      expect(fs.existsSync(path.join(destDir, "references", "a.md"))).toBe(true);
      expect(text).toContain("Skipped - already present (1): SKILL.md");
      expect(text).toContain("Copied (2):");
      const porcelain = git(repo, ["status", "--porcelain"]);
      expect(porcelain).not.toContain("SKILL.md");
      expect(porcelain).toContain(".pi/skills/my-skill/references/a.md");
      expect(porcelain).toContain(".pi/skills/my-skill/scripts/x.sh");
    });

    it("writes nothing and asks for confirmation on global scope without confirmed", async () => {
      const forgeHome = makeTempDir();
      tempDirs.push(forgeHome);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));

      const text = await run({ path: source, scope: "global" }, new SkillPersistTool(forgeHome));

      expect(text).toContain("global scope requires explicit user confirmation");
      expect(text).toContain(
        `Would persist "my-skill" to ${path.join(forgeHome, "skills", "my-skill")}`,
      );
      expect(text).toContain("No files were written");
      expect(text).toContain("re-invoke with confirmed: true");
      expect(fs.existsSync(path.join(forgeHome, "skills", "my-skill"))).toBe(false);
    });

    it("writes to <globalHome>/skills/<name> on global scope with confirmed: true", async () => {
      const forgeHome = makeTempDir();
      tempDirs.push(forgeHome);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));

      const text = await run(
        { path: source, scope: "global", confirmed: true },
        new SkillPersistTool(forgeHome),
      );

      const destDir = path.join(forgeHome, "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(destDir, "references", "a.md"))).toBe(true);
      expect(text).toContain('[ok] skill "my-skill" persisted to global scope');
      expect(text).toContain(`Destination: ${destDir}`);
      expect(text).toContain("not a git repo - files written, will not ride a commit");
      expect(text).toContain("Next: the user confirmed");
    });

    it("falls back to <cwd>/.pi/skills and reports not-a-git-repo outside a git repo", async () => {
      const cwdDir = makeTempDir();
      tempDirs.push(cwdDir);
      mockCwd(cwdDir);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(cwdDir, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(text).toContain("not a git repo - files written, will not ride a commit");
    });

    it("warns when the frontmatter name differs from the directory name", async () => {
      const forgeHome = makeTempDir();
      tempDirs.push(forgeHome);
      const source = makeSourceSkill(makeTempDir(), "my-skill", "other-name");
      tempDirs.push(path.dirname(source));

      const text = await run(
        { path: source, scope: "global", confirmed: true },
        new SkillPersistTool(forgeHome),
      );

      expect(text).toContain(
        '[warn] SKILL.md frontmatter name "other-name" differs from the directory name - persisted as "my-skill"',
      );
    });

    it("normalizes a SKILL.md file path to its parent skill directory", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: path.join(source, "SKILL.md"), scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(text).toContain(`Destination: ${destDir}`);
    });

    it("rejects a source directory whose name is not a valid skill name", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const badSource = makeSourceSkill(makeTempDir(), "Bad-Name");
      tempDirs.push(path.dirname(badSource));
      mockCwd(repo);

      const text = await run({ path: badSource, scope: "project" });

      expect(text).toContain('directory name "Bad-Name" is not a valid skill name');
      expect(fs.existsSync(path.join(repo, ".pi", "skills"))).toBe(false);
    });

    it("rejects a directory name longer than 64 chars", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const longName = "a".repeat(65);
      const source = makeSourceSkill(makeTempDir(), longName);
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      expect(text).toContain(`directory name "${longName}" is not a valid skill name`);
      expect(fs.existsSync(path.join(repo, ".pi", "skills"))).toBe(false);
    });

    it("persists without a name warning when the frontmatter has no closing fence", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const source = makeTempDir();
      tempDirs.push(source);
      write(source, "my-skill/SKILL.md", "---\nname: my-skill\ndescription: Test skill.\n");
      mockCwd(repo);

      const text = await run({ path: path.join(source, "my-skill"), scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(text).not.toContain("[warn]");
    });

    it("reports 'none' when every destination file already exists", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      makeSourceSkill(path.join(repo, ".pi", "skills"), "my-skill");
      git(repo, ["add", ".pi"]);
      git(repo, ["commit", "-m", "seed skill"]);
      // Persist the identical skill again from a separate source: nothing new.
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      expect(text).toContain("Skipped - already present (3):");
      expect(text).toContain("Git: none - nothing new to stage");
      // Nothing was copied, so git add is skipped entirely: no staging, no
      // staged file count, and no "rides the current work's commit" claim.
      expect(text).not.toContain("staged");
      expect(text).toContain("Next: nothing new to stage - all skill files already exist at");
      expect(git(repo, ["status", "--porcelain"])).toBe("");
    });

    it("reports the real cause from git stderr and an honest next step when git add fails", async () => {
      const fakeRepo = makeTempDir();
      tempDirs.push(fakeRepo);
      // A `.git` FILE makes findGitRoot succeed but git itself fail.
      write(fakeRepo, ".git", "not a git repository\n");
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(fakeRepo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(fakeRepo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      // The stderr cause surfaces (not the execFileSync "Command failed" wrapper).
      expect(text).toContain("Git: git add failed: fatal: invalid gitfile format");
      expect(text).not.toContain("Command failed: git");
      // No false claim that the skill rides the current work's commit.
      expect(text).not.toContain("not a git repo - files written");
      expect(text).not.toContain("rides the current work's commit");
      expect(text).toContain("Next: staging failed: fatal: invalid gitfile format");
      expect(text).toContain(`files written at ${destDir}`);
      expect(text).toContain("commit them manually");
    });

    it("reports the gitignore cause when the destination home is ignored", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      write(repo, ".gitignore", ".pi/\n");
      git(repo, ["add", ".gitignore"]);
      git(repo, ["commit", "-m", "ignore .pi"]);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(text).toContain("Git: git add failed: The following paths are ignored");
      expect(text).toContain("Next: staging failed:");
      expect(text).not.toContain("rides the current work's commit");
      // The ignored home is never staged.
      expect(git(repo, ["status", "--porcelain"])).not.toContain(".pi/skills");
    });

    it("scopes git add to the copied files, leaving modified pre-existing files unstaged", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      // Seed a tracked, pre-existing file that the source skill does not contain.
      write(repo, ".pi/skills/my-skill/custom.md", "v1\n");
      git(repo, ["add", ".pi/skills/my-skill"]);
      git(repo, ["commit", "-m", "seed skill"]);
      // Local, unstaged modification to that pre-existing file.
      write(repo, ".pi/skills/my-skill/custom.md", "v2\n");
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "references", "a.md"))).toBe(true);
      // Copied files are staged...
      expect(text).toContain("Git: staged 3 file(s):");
      const porcelain = git(repo, ["status", "--porcelain"]);
      expect(porcelain).toContain("A  .pi/skills/my-skill/SKILL.md");
      expect(porcelain).toContain("A  .pi/skills/my-skill/references/a.md");
      // ...but the pre-existing modified file stays unstaged (scoped add).
      expect(porcelain).toContain(" M .pi/skills/my-skill/custom.md");
      expect(porcelain).not.toContain("M  .pi/skills/my-skill/custom.md");
    });

    it("stages a copied file with glob characters literally, not its glob matches", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      // A tracked, pre-existing sibling that the source's references/a*.md
      // would glob-match if git treated the copied path as a pattern.
      write(repo, ".pi/skills/my-skill/references/abc.md", "v1\n");
      git(repo, ["add", ".pi/skills/my-skill"]);
      git(repo, ["commit", "-m", "seed skill"]);
      write(repo, ".pi/skills/my-skill/references/abc.md", "v2\n");
      // Source skill containing a file literally named a*.md.
      const source = makeTempDir();
      tempDirs.push(source);
      write(
        source,
        "my-skill/SKILL.md",
        "---\nname: my-skill\ndescription: Test skill.\n---\n\n# my-skill\n",
      );
      write(source, "my-skill/references/a*.md", "# A\n");
      write(source, "my-skill/scripts/x.sh", "#!/bin/sh\necho ok\n");
      mockCwd(repo);

      const text = await run({ path: path.join(source, "my-skill"), scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "references", "a*.md"))).toBe(true);
      expect(text).toContain("Git: staged 3 file(s):");
      const porcelain = git(repo, ["status", "--porcelain"]);
      expect(porcelain).toContain("A  .pi/skills/my-skill/references/a*.md");
      expect(porcelain).toContain("A  .pi/skills/my-skill/SKILL.md");
      // The glob sibling (tracked, locally modified) stays unstaged: the
      // pathspec is literal, so git add never glob-expands it.
      expect(porcelain).toContain(" M .pi/skills/my-skill/references/abc.md");
      expect(porcelain).not.toContain("M  .pi/skills/my-skill/references/abc.md");
    });

    it("reports the staged subset when git add fails partway on ignored paths", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      // Only scripts/x.sh is ignored; the other copies must still stage.
      write(repo, ".gitignore", ".pi/skills/my-skill/scripts/*.sh\n");
      git(repo, ["add", ".gitignore"]);
      git(repo, ["commit", "-m", "ignore scripts"]);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      const destDir = path.join(repo, ".pi", "skills", "my-skill");
      expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
      expect(text).toContain("Git: git add failed: The following paths are ignored");
      // The blocked path lives on stderr line 2+ - surfaced, not truncated.
      expect(text).toContain(".pi/skills/my-skill/scripts/x.sh");
      // The non-ignored copies staged before the failure are reported, not [].
      expect(text).toContain("Staged before the failure (2):");
      expect(text).toContain(".pi/skills/my-skill/SKILL.md");
      expect(text).toContain(".pi/skills/my-skill/references/a.md");
      expect(text).not.toContain("rides the current work's commit");
      const porcelain = git(repo, ["status", "--porcelain"]);
      expect(porcelain).toContain("A  .pi/skills/my-skill/SKILL.md");
      expect(porcelain).toContain("A  .pi/skills/my-skill/references/a.md");
      expect(porcelain).not.toContain("scripts/x.sh");
    });

    it("rejects a source directory without SKILL.md", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      const source = makeSourceSkill(makeTempDir(), "my-skill");
      tempDirs.push(path.dirname(source));
      fs.rmSync(path.join(source, "SKILL.md"));
      mockCwd(repo);

      const text = await run({ path: source, scope: "project" });

      expect(text).toContain("not a skill directory (SKILL.md missing)");
      expect(fs.existsSync(path.join(repo, ".pi", "skills"))).toBe(false);
    });

    it("returns an error result (not a throw) for a missing source", async () => {
      const repo = makeRepo();
      tempDirs.push(repo);
      mockCwd(repo);
      const missingRoot = makeTempDir();
      tempDirs.push(missingRoot);
      const missing = path.join(missingRoot, "my-skill");

      const text = await run({ path: missing, scope: "project" });

      expect(text).toContain("skill_persist: source not found:");
    });
  });
});

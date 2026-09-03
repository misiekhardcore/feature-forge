import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";

import { SkillValidateTool } from "./SkillValidateTool";

const tool = new SkillValidateTool();

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-validate-"));
}

/**
 * Create a temp root plus a valid-named skill dir inside it. mkdtemp's
 * random suffix can contain uppercase letters (e.g. skill-validate-DDr36Q),
 * which would fail the directory-name rule - so tests validate a nested
 * dir whose basename is a real skill name, never the tmp root itself.
 */
function makeSkillDir(name = "my-skill"): string {
  const root = makeTempDir();
  tempDirs.push(root);
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a file at <root>/<rel>, creating parent directories. */
function write(root: string, rel: string, content: string): string {
  const filePath = path.join(root, rel);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

/** Execute against a path and return the result text. */
async function run(pathToValidate: string): Promise<string> {
  const result = await tool.execute("call-1", { path: pathToValidate }, undefined);
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SkillValidateTool", () => {
  it("has name 'skill_validate'", () => {
    expect(tool.name).toBe("skill_validate");
  });

  it("has a label and a description", () => {
    expect(tool.label).toBe("Validate Skill");
    expect(tool.description).toBeTruthy();
  });

  it("defines parameters requiring a non-empty path", () => {
    expect(Value.Check(tool.parameters, { path: "/tmp/skill" })).toBe(true);
    expect(Value.Check(tool.parameters, { path: "" })).toBe(false);
    expect(Value.Check(tool.parameters, {})).toBe(false);
  });

  describe("execute", () => {
    it("passes a minimal valid skill (SKILL.md + references/ + scripts/)", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));
      write(dir, "references/a.md", "# A\n");
      write(dir, "scripts/x.sh", "#!/bin/sh\necho ok\n");

      const text = await run(dir);

      expect(text).toContain(`Validation of skill at ${dir}`);
      expect(text).toContain("[ok] SKILL.md found at ");
      expect(text).toContain("[ok] SKILL.md frontmatter parses (YAML)");
      expect(text).toContain(`[ok] name "my-skill" follows the naming rule`);
      expect(text).toContain("[ok] description is present (22 chars, under 1024)");
      expect(text).toContain("[ok] references/ is one level deep (files only)");
      expect(text).toContain("[ok] no empty directories");
      expect(text).toContain("[info] scripts/x.sh: executable-friendly (shebang present)");
      expect(text).not.toContain("[error]");
      expect(text).not.toContain("[warn]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("fails when SKILL.md is missing", async () => {
      const dir = makeSkillDir();
      write(dir, "references/a.md", "# orphan\n");

      const text = await run(dir);

      expect(text).toContain("[error] SKILL.md not found at ");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors on an invalid (uppercase) frontmatter name", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", skillMd("My-Skill", "Validates test skills."));

      const text = await run(dir);

      expect(text).toContain('[error] name "My-Skill" is invalid (lowercase');
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter description is missing", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "---\nname: my-skill\n---\n\n# my-skill\n");

      const text = await run(dir);

      expect(text).toContain("[error] description is required and must be a non-empty string");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter description exceeds 1024 chars", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", skillMd("my-skill", "a".repeat(1025)));

      const text = await run(dir);

      expect(text).toContain("[error] description is 1025 chars (max 1024)");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter YAML does not parse", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "---\nname: [unclosed\n---\n");

      const text = await run(dir);

      expect(text).toContain("[error] SKILL.md frontmatter: YAML does not parse:");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter lacks a closing fence", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "---\nname: my-skill\ndescription: Validates test skills.\n");

      const text = await run(dir);

      expect(text).toContain("[error] SKILL.md frontmatter: missing closing --- fence");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the SKILL.md never opens a frontmatter fence", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "# my-skill\n\nNo frontmatter here.\n");

      const text = await run(dir);

      expect(text).toContain("[error] SKILL.md frontmatter: missing opening --- fence");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("reports required fields for empty frontmatter (parses to null like pi)", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "---\n---\n\n# my-skill\n");

      const text = await run(dir);

      expect(text).toContain("[ok] SKILL.md frontmatter parses (YAML)");
      expect(text).toContain("[error] name is required and must be a string");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter name is not a string", async () => {
      const dir = makeSkillDir();
      write(
        dir,
        "SKILL.md",
        "---\nname: [one, two]\ndescription: Validates test skills.\n---\n\n# my-skill\n",
      );

      const text = await run(dir);

      expect(text).toContain("[error] name is required and must be a string");
      expect(text).not.toContain('name "[one, two]" is invalid');
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("errors when the frontmatter is not a YAML mapping", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "---\njust a string\n---\n# body\n");

      const text = await run(dir);

      expect(text).toContain("[error] SKILL.md frontmatter: frontmatter must be a YAML mapping");
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("warns on a nested directory inside references/ but still passes", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));
      write(dir, "references/sub/inner.md", "# nested\n");

      const text = await run(dir);

      expect(text).toContain('[warn] references/ contains nested directory "sub"');
      expect(text).not.toContain("[error]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("warns on an empty directory but still passes", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));
      fs.mkdirSync(path.join(dir, "references"));

      const text = await run(dir);

      expect(text).toContain('[warn] empty directory "references"');
      expect(text).not.toContain("[error]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("errors when the directory name is not a valid skill name (dir name = skill name mandate)", async () => {
      const dir = makeSkillDir("Bad-Name");
      write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));

      const text = await run(dir);

      expect(text).toContain(
        '[error] directory name "Bad-Name" is not a valid skill name (lowercase',
      );
      expect(text.endsWith("passed: false")).toBe(true);
    });

    it("warns (still passes) when a valid frontmatter name differs from a valid directory name", async () => {
      const dir = makeSkillDir("other-name");
      write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));

      const text = await run(dir);

      expect(text).toContain('[warn] name "my-skill" differs from the directory name "other-name"');
      expect(text).toContain('[ok] directory name "other-name" follows the naming rule');
      expect(text).not.toContain("[error]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("normalizes a SKILL.md file path to its parent directory", async () => {
      const dir = makeSkillDir();
      const skillMdPath = write(dir, "SKILL.md", skillMd("my-skill", "Validates test skills."));

      const text = await run(skillMdPath);

      expect(text).toContain(`Validation of skill at ${dir}`);
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("passes a SKILL.md with a leading UTF-8 BOM (as pi loads it)", async () => {
      const dir = makeSkillDir();
      write(dir, "SKILL.md", "\uFEFF" + skillMd("my-skill", "Validates test skills."));

      const text = await run(dir);

      expect(text).toContain("[ok] SKILL.md frontmatter parses (YAML)");
      expect(text).not.toContain("[error]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("passes a SKILL.md with CRLF line endings (as pi normalizes them)", async () => {
      const dir = makeSkillDir();
      const crlf = skillMd("my-skill", "Validates test skills.").replace(/\n/g, "\r\n");
      write(dir, "SKILL.md", crlf);

      const text = await run(dir);

      expect(text).toContain("[ok] SKILL.md frontmatter parses (YAML)");
      expect(text).toContain(`[ok] name "my-skill" follows the naming rule`);
      expect(text).toContain("[ok] description is present (22 chars, under 1024)");
      expect(text).not.toContain("[error]");
      expect(text.endsWith("passed: true")).toBe(true);
    });

    it("returns an error result (not a throw) for a missing path", async () => {
      const text = await run(path.join(os.tmpdir(), "does-not-exist-skill"));

      expect(text).toContain("[error] cannot validate ");
      expect(text.endsWith("passed: false")).toBe(true);
    });
  });
});

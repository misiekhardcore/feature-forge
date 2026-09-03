import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import type { Static } from "typebox";
import { Type } from "typebox";
import { parse as parseYaml } from "yaml";

const SkillValidateParams = Type.Object({
  path: Type.String({
    description: "Path to a skill directory, or to its SKILL.md file",
    minLength: 1,
  }),
});

type SkillValidateArgs = Static<typeof SkillValidateParams>;

interface SkillFinding {
  level: "ok" | "warn" | "error" | "info";
  text: string;
}

interface SkillFrontmatter {
  ok: boolean;
  /** Error detail when ok is false. */
  error?: string;
  /** Parsed frontmatter fields when ok is true. */
  data?: Record<string, unknown>;
}

const NAME_RULE = "lowercase a-z/0-9, hyphens, no leading/trailing/consecutive hyphens, 1-64 chars";
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_MAX = 1024;

/**
 * Deterministic structure gate for skills, per the house mandate in
 * `packages/core/src/skills/create-skill/references/structure-guide.md`.
 *
 * Runs locally in the root session (no child IPC). Reports every check as
 * an `[ok]` / `[warn]` / `[error]` / `[info]` finding and closes with a
 * machine-readable `passed: true|false` line. Errors fail the gate;
 * warnings and informational findings do not.
 */
export class SkillValidateTool extends Tool {
  readonly name = "skill_validate";
  readonly label = "Validate Skill";
  readonly description =
    "Validate a skill directory against the house structure mandate (SKILL.md frontmatter, name and description rules, references depth, no empty directories, scripts contract). Use when a skill was created or edited and needs a deterministic gate before skill_persist.";
  readonly parameters = SkillValidateParams;

  async execute(
    _toolCallId: string,
    params: SkillValidateArgs,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();

    const skillDir = this.normalizeSkillDir(params.path);
    if (!skillDir) {
      return this.textResult(
        [`[error] cannot validate ${params.path}: path does not exist`, "passed: false"].join("\n"),
      );
    }

    const findings = this.validate(skillDir);
    const errors = findings.filter((finding) => finding.level === "error").length;
    const warnings = findings.filter((finding) => finding.level === "warn").length;
    const oks = findings.filter((finding) => finding.level === "ok").length;

    const lines = [`Validation of skill at ${skillDir}`];
    for (const finding of findings) {
      lines.push(`[${finding.level}] ${finding.text}`);
    }
    lines.push(`Summary: ${oks} ok, ${warnings} warn, ${errors} error`);
    lines.push(`passed: ${errors === 0}`);

    return this.textResult(lines.join("\n"));
  }

  /**
   * Normalize the tool input to the skill directory: a directory is used
   * as-is, a file (typically SKILL.md) resolves to its parent directory.
   * Returns null when nothing exists at the given path.
   */
  private normalizeSkillDir(input: string): string | null {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      return null;
    }
    return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  }

  /** Run the full check list against a skill directory. */
  private validate(skillDir: string): SkillFinding[] {
    const findings: SkillFinding[] = [];
    const skillMdPath = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillMdPath)) {
      findings.push({ level: "error", text: `SKILL.md not found at ${skillMdPath}` });
      return findings;
    }
    findings.push({ level: "ok", text: `SKILL.md found at ${skillMdPath}` });

    // Directory-name rule runs independently of the frontmatter: the source
    // directory basename IS the skill name, and skill_persist hard-rejects a
    // source whose basename is not a valid skill name - so the validate gate
    // must error on it even when the SKILL.md frontmatter is unparseable.
    this.checkDirectoryName(findings, skillDir);

    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      findings.push({ level: "error", text: `SKILL.md cannot be read: ${detail}` });
      return findings;
    }

    const frontmatter = this.parseFrontmatter(content);
    if (!frontmatter.ok) {
      findings.push({ level: "error", text: `SKILL.md frontmatter: ${frontmatter.error}` });
      // Tree-level checks below still run - they do not need frontmatter.
    } else {
      findings.push({ level: "ok", text: "SKILL.md frontmatter parses (YAML)" });
      this.checkName(findings, skillDir, frontmatter.data!);
      this.checkDescription(findings, frontmatter.data!);
    }

    this.checkReferences(findings, skillDir);
    this.checkEmptyDirectories(findings, skillDir);
    this.checkScripts(findings, skillDir);

    return findings;
  }

  /**
   * Directory-name rule (house mandate "dir name = skill name"): the source
   * directory basename must itself be a valid skill name. skill_persist
   * hard-rejects a source dir whose basename is not, so an invalid directory
   * name is an error here - a valid-but-different frontmatter name stays a
   * warning (see checkName).
   */
  private checkDirectoryName(findings: SkillFinding[], skillDir: string): void {
    const dirName = path.basename(skillDir);
    if (dirName.length > 64 || !NAME_PATTERN.test(dirName)) {
      findings.push({
        level: "error",
        text: `directory name "${dirName}" is not a valid skill name (${NAME_RULE})`,
      });
    } else {
      findings.push({
        level: "ok",
        text: `directory name "${dirName}" follows the naming rule (${NAME_RULE})`,
      });
    }
  }

  /** Frontmatter name rules + directory-name match (house preference). */
  private checkName(
    findings: SkillFinding[],
    skillDir: string,
    frontmatter: Record<string, unknown>,
  ): void {
    const name = frontmatter.name;
    if (typeof name !== "string" || name.length === 0) {
      findings.push({
        level: "error",
        text: `name is required and must be a string (${NAME_RULE})`,
      });
      return;
    }
    if (name.length > 64 || !NAME_PATTERN.test(name)) {
      findings.push({
        level: "error",
        text: `name "${name}" is invalid (${NAME_RULE})`,
      });
      return;
    }
    findings.push({
      level: "ok",
      text: `name "${name}" follows the naming rule (${NAME_RULE})`,
    });
    const dirName = path.basename(skillDir);
    if (name !== dirName) {
      findings.push({
        level: "warn",
        text: `name "${name}" differs from the directory name "${dirName}" (house prefers the directory name)`,
      });
    } else {
      findings.push({ level: "ok", text: `name matches the directory name "${dirName}"` });
    }
  }

  /** Description: present, a string, non-empty, at most 1024 chars. */
  private checkDescription(findings: SkillFinding[], frontmatter: Record<string, unknown>): void {
    const description = frontmatter.description;
    if (typeof description !== "string" || description.trim().length === 0) {
      findings.push({
        level: "error",
        text: "description is required and must be a non-empty string (under 1024 chars)",
      });
      return;
    }
    if (description.length > DESCRIPTION_MAX) {
      findings.push({
        level: "error",
        text: `description is ${description.length} chars (max ${DESCRIPTION_MAX})`,
      });
      return;
    }
    findings.push({
      level: "ok",
      text: `description is present (${description.length} chars, under ${DESCRIPTION_MAX})`,
    });
  }

  /** references/ must hold files only - one level deep, no nested dirs. */
  private checkReferences(findings: SkillFinding[], skillDir: string): void {
    const referencesDir = path.join(skillDir, "references");
    if (!fs.existsSync(referencesDir)) {
      return;
    }
    const entries = fs.readdirSync(referencesDir, { withFileTypes: true });
    if (entries.length === 0) {
      // Empty references/ is flagged by the empty-directory check.
      return;
    }
    const nested = entries.filter((entry) => entry.isDirectory());
    if (nested.length === 0) {
      findings.push({ level: "ok", text: "references/ is one level deep (files only)" });
      return;
    }
    for (const entry of nested) {
      findings.push({
        level: "warn",
        text: `references/ contains nested directory "${entry.name}" (one level deep only: references/<topic>.md)`,
      });
    }
  }

  /** No empty directories anywhere in the skill tree. */
  private checkEmptyDirectories(findings: SkillFinding[], skillDir: string): void {
    const empty: string[] = [];
    const visit = (dir: string, rel: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.length === 0) {
        empty.push(rel);
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          visit(path.join(dir, entry.name), rel === "" ? entry.name : `${rel}/${entry.name}`);
        }
      }
    };
    visit(skillDir, "");
    if (empty.length === 0) {
      findings.push({ level: "ok", text: "no empty directories" });
      return;
    }
    for (const rel of empty) {
      findings.push({ level: "warn", text: `empty directory "${rel}"` });
    }
  }

  /** scripts/: informational listing with the shebang/interpreter hint. */
  private checkScripts(findings: SkillFinding[], skillDir: string): void {
    const scriptsDir = path.join(skillDir, "scripts");
    if (!fs.existsSync(scriptsDir)) {
      return;
    }
    const files: string[] = [];
    const walk = (dir: string, rel: string): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel === "" ? entry.name : `${rel}/${entry.name}`);
        } else if (entry.isFile()) {
          files.push(rel === "" ? entry.name : `${rel}/${entry.name}`);
        }
      }
    };
    walk(scriptsDir, "");
    for (const rel of files) {
      const hasShebang = this.hasShebang(path.join(scriptsDir, rel));
      findings.push({
        level: "info",
        text: hasShebang
          ? `scripts/${rel}: executable-friendly (shebang present)`
          : `scripts/${rel}: no shebang - verify it is executable-friendly or invoked via its interpreter`,
      });
    }
  }

  /** True when the file's first line starts with a #! shebang. */
  private hasShebang(filePath: string): boolean {
    try {
      const firstLine = fs.readFileSync(filePath, "utf8").split("\n", 1)[0] ?? "";
      return firstLine.startsWith("#!");
    } catch {
      return false;
    }
  }

  /**
   * Parse SKILL.md frontmatter with the same fence rules pi uses: an
   * opening `---` line and a closing `---` line, over the same
   * BOM-stripped, CRLF-normalized content pi loads. Distinguishes missing
   * fences from malformed YAML (pi's parseFrontmatter silently returns {}
   * for both, which would hide the failure this gate must surface).
   */
  private parseFrontmatter(content: string): SkillFrontmatter {
    const normalized = this.piNormalizeContent(content);
    if (!normalized.startsWith("---")) {
      return {
        ok: false,
        error: "missing opening --- fence (SKILL.md must open with YAML frontmatter)",
      };
    }
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex === -1) {
      return { ok: false, error: "missing closing --- fence" };
    }
    const yamlString = normalized.slice(4, endIndex);
    let parsed: unknown;
    try {
      parsed = parseYaml(yamlString);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `YAML does not parse: ${detail}` };
    }
    if (parsed === null) {
      return { ok: true, data: {} };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "frontmatter must be a YAML mapping" };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  }

  /**
   * Mirror pi's SKILL.md preprocessing (dist/utils/frontmatter.js): strip
   * a leading UTF-8 BOM and normalize CRLF/CR to LF before the fence scan,
   * so a BOM/CRLF SKILL.md that loads in pi passes this gate.
   */
  private piNormalizeContent(content: string): string {
    const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
    return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  private textResult(text: string): AgentToolResult<unknown> {
    return {
      content: [{ type: "text", text }],
      details: undefined,
    };
  }
}

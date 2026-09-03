import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, Tool } from "@feature-forge/core";
import type { Static } from "typebox";
import { Type } from "typebox";
import { parse as parseYaml } from "yaml";

const SkillPersistParams = Type.Object({
  path: Type.String({
    description: "Path to the skill directory to persist, or to its SKILL.md",
    minLength: 1,
  }),
  scope: Type.Union([Type.Literal("project"), Type.Literal("global")]),
  confirmed: Type.Optional(
    Type.Boolean({
      description: "Explicit user confirmation for global writes. Required when scope is 'global'.",
    }),
  ),
});

type SkillPersistArgs = Static<typeof SkillPersistParams>;

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface CopyReport {
  copied: string[];
  skipped: string[];
}

interface GitReport {
  /** Status: "staged", "none", "not a git repo", or "add-failed". */
  status: "staged" | "none" | "not a git repo" | "add-failed";
  /** Git-root-relative paths staged. Empty when nothing was staged; on
   * "add-failed" this is the subset git staged before the failure. */
  staged: string[];
  /** Root cause detail when status is "add-failed". */
  error?: string;
}

/**
 * Scope-resolved persistence for skills, per the rubric in
 * `packages/core/src/skills/create-skill/references/scoping.md`.
 *
 * Resolves the destination home from the scope (project: `<git root>/.pi/skills`,
 * global: `<forgeDir>/skills`), enforces the confirmation gate for global
 * writes, copies the skill tree extend-don't-clobber, and stages new files
 * in git-backed homes. NEVER commits - the flow's own commit step picks up
 * project files at PR time.
 */
export class SkillPersistTool extends Tool {
  readonly name = "skill_persist";
  readonly label = "Persist Skill";
  readonly description =
    "Persist a validated skill to its scope home (project: <repo>/.pi/skills, global: <forgeDir>/skills). Global writes require explicit user confirmation via the confirmed parameter. Stages new files in git-backed homes but never commits.";
  readonly parameters = SkillPersistParams;

  async execute(
    _toolCallId: string,
    params: SkillPersistArgs,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const { path: sourceInput, scope, confirmed } = params;

    const sourceDir = this.resolveSourceDir(sourceInput);
    if (!sourceDir) {
      return this.textResult(`skill_persist: source not found: ${sourceInput}`);
    }
    const skillName = path.basename(sourceDir);
    if (!NAME_PATTERN.test(skillName) || skillName.length > 64) {
      return this.textResult(
        `skill_persist: directory name "${skillName}" is not a valid skill name ` +
          "(lowercase a-z/0-9, hyphens, no leading/trailing/consecutive hyphens, 1-64 chars)",
      );
    }
    if (!fs.existsSync(path.join(sourceDir, "SKILL.md"))) {
      return this.textResult(
        `skill_persist: ${sourceDir} is not a skill directory (SKILL.md missing) - nothing written`,
      );
    }

    const destDir = this.resolveDestDir(skillName, scope);

    if (scope === "global" && confirmed !== true) {
      return this.textResult(
        [
          `skill_persist: global scope requires explicit user confirmation`,
          `Would persist "${skillName}" to ${destDir}`,
          "No files were written. Ask the user for explicit confirmation, then re-invoke with confirmed: true.",
        ].join("\n"),
      );
    }

    const copyReport = this.copySkill(sourceDir, destDir);
    const gitReport = this.stageInGit(destDir, copyReport.copied);
    const nameWarn = this.nameMismatchWarning(sourceDir, skillName);

    const lines = [`[ok] skill "${skillName}" persisted to ${scope} scope`];
    lines.push(`Destination: ${destDir}`);
    lines.push(`Copied (${copyReport.copied.length}): ${this.formatList(copyReport.copied)}`);
    lines.push(
      `Skipped - already present (${copyReport.skipped.length}): ${this.formatList(
        copyReport.skipped,
      )}`,
    );
    lines.push(`Git: ${this.formatGitStatus(gitReport)}`);
    if (nameWarn) {
      lines.push(nameWarn);
    }
    lines.push(this.nextStepLine(scope, gitReport, destDir));

    return this.textResult(lines.join("\n"));
  }

  /**
   * Resolve the tool input to the source skill directory: a directory is
   * used as-is, a file (typically SKILL.md) resolves to its parent.
   * Returns null when nothing exists at the given path.
   */
  private resolveSourceDir(input: string): string | null {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      return null;
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return resolved;
    }
    return stat.isFile() ? path.dirname(resolved) : null;
  }

  /**
   * Resolve the destination skill directory for the given scope.
   *
   * Project: walk up from the current directory to the git root
   * (`<git root>/.pi/skills/<name>`); without a git root, fall back to
   * `<cwd>/.pi/skills/<name>`.
   *
   * Global: `<forgeDir>/skills/<name>` with the same try/fallback pattern
   * as forge-skills.ts (ForgeConfig, else `path.resolve(".forge")`).
   */
  private resolveDestDir(skillName: string, scope: "project" | "global"): string {
    if (scope === "project") {
      const gitRoot = this.findGitRoot(process.cwd());
      const home = gitRoot ?? process.cwd();
      return path.join(home, ".pi", "skills", skillName);
    }
    let forgeDir: string;
    try {
      forgeDir = ForgeConfig.getInstance().getForgeDir();
    } catch {
      forgeDir = path.resolve(".forge");
    }
    return path.join(forgeDir, "skills", skillName);
  }

  /**
   * Copy the skill tree into destDir, extend-don't-clobber: files that
   * already exist at the destination are left untouched and reported as
   * skipped.
   */
  private copySkill(sourceDir: string, destDir: string): CopyReport {
    const copied: string[] = [];
    const skipped: string[] = [];
    fs.mkdirSync(destDir, { recursive: true });

    const visit = (dir: string, rel: string): void => {
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        // Symlinks are ignored - skills are plain files and directories.
        if (entry.isSymbolicLink()) {
          continue;
        }
        const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
        const destPath = path.join(destDir, relPath);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          visit(path.join(dir, entry.name), relPath);
        } else {
          if (fs.existsSync(destPath)) {
            skipped.push(relPath);
          } else {
            fs.copyFileSync(path.join(dir, entry.name), destPath);
            copied.push(relPath);
          }
        }
      }
    };

    visit(sourceDir, "");
    return { copied, skipped };
  }

  /**
   * Stage the copied files that landed inside a git repo - scoped to the
   * copied paths only, never the whole destination tree, and skipped
   * entirely when nothing was copied. Never commits. Statuses: "staged",
   * "none" (nothing copied), "not a git repo", or "add-failed" (with the
   * real cause on report.error and the staged subset on report.staged).
   */
  private stageInGit(destDir: string, copied: string[]): GitReport {
    if (copied.length === 0) {
      return { status: "none", staged: [] };
    }
    const gitRoot = this.findGitRoot(destDir);
    if (!gitRoot) {
      return { status: "not a git repo", staged: [] };
    }
    const relBase = path.relative(gitRoot, destDir);
    const relPaths = copied.map((relPath) => (relBase === "" ? relPath : `${relBase}/${relPath}`));
    // Pin each pathspec with git's (literal) magic: plain pathspecs treat
    // `*?[]` as globs, so a copied file named e.g. "a*.md" would silently
    // stage its glob matches (pre-existing siblings) too.
    const pathspecs = relPaths.map((relPath) => `:(literal)${relPath}`);
    try {
      execFileSync("git", ["-C", gitRoot, "add", "--", ...pathspecs], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return {
        status: "add-failed",
        // git exits non-zero but still stages the non-ignored pathspecs on
        // a partial failure - reconcile the real staged subset so the
        // report never claims nothing was staged.
        staged: this.stagedSubset(gitRoot, pathspecs),
        error: this.gitFailureDetail(error),
      };
    }
    return { status: "staged", staged: relPaths };
  }

  /** Git-root-relative paths currently in the index that match pathspecs. */
  private stagedSubset(gitRoot: string, pathspecs: string[]): string[] {
    try {
      const out = execFileSync(
        "git",
        ["-C", gitRoot, "diff", "--cached", "--name-only", "--", ...pathspecs],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      return out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      // The index is unreachable (e.g. corrupt .git) - nothing to report.
      return [];
    }
  }

  /**
   * Extract the real cause of a failed git invocation. execFileSync wraps
   * the command in its message ("Command failed: git ...") and keeps the
   * actual output in error.stderr - report the meaningful stderr lines
   * (git's `hint:` advice is dropped), falling back to the error message
   * when stderr is empty.
   */
  private gitFailureDetail(error: unknown): string {
    if (error instanceof Error) {
      const stderr = (error as Error & { stderr?: unknown }).stderr;
      if (typeof stderr === "string" && stderr.trim().length > 0) {
        const lines = stderr
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("hint:"));
        if (lines.length > 0) {
          return lines.join("\n");
        }
      }
      return error.message;
    }
    return String(error);
  }

  /** Walk up from startDir to the nearest ancestor containing `.git`. */
  private findGitRoot(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (;;) {
      if (fs.existsSync(path.join(dir, ".git"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }

  /**
   * Read the source SKILL.md frontmatter `name`. Returns undefined when the
   * frontmatter is missing or does not parse (skill_validate is the gate
   * that reports those; persist only warns on a mismatch).
   */
  private readFrontmatterName(skillDir: string): string | undefined {
    let content: string;
    try {
      content = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    } catch {
      return undefined;
    }
    if (!content.startsWith("---")) {
      return undefined;
    }
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex === -1) {
      return undefined;
    }
    try {
      const parsed: unknown = parseYaml(content.slice(4, endIndex));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return undefined;
      }
      const name = (parsed as Record<string, unknown>).name;
      return typeof name === "string" ? name : undefined;
    } catch {
      return undefined;
    }
  }

  /** Warning when the frontmatter name differs from the directory name. */
  private nameMismatchWarning(sourceDir: string, skillName: string): string | null {
    const frontmatterName = this.readFrontmatterName(sourceDir);
    if (frontmatterName !== undefined && frontmatterName !== skillName) {
      return `[warn] SKILL.md frontmatter name "${frontmatterName}" differs from the directory name - persisted as "${skillName}"`;
    }
    return null;
  }

  private formatList(items: string[]): string {
    return items.length === 0 ? "(none)" : items.join(", ");
  }

  private formatGitStatus(report: GitReport): string {
    if (report.status === "staged") {
      return `staged ${report.staged.length} file(s): ${report.staged.join(", ")}`;
    }
    if (report.status === "none") {
      return "none - nothing new to stage";
    }
    if (report.status === "not a git repo") {
      return "not a git repo - files written, will not ride a commit";
    }
    const partial =
      report.staged.length > 0
        ? `\nStaged before the failure (${report.staged.length}): ${report.staged.join(", ")}`
        : "";
    return `git add failed: ${report.error ?? "unknown git error"}${partial}`;
  }

  private nextStepLine(scope: "project" | "global", report: GitReport, destDir: string): string {
    if (scope === "global") {
      return (
        "Next: the user confirmed - tell them the skill is live from the next session start " +
        "(run forge:init or restart pi to activate)."
      );
    }
    switch (report.status) {
      case "staged":
        return "Next: the skill rides the current work's commit (the flow's commit step picks it up at PR time).";
      case "none":
        return `Next: nothing new to stage - all skill files already exist at ${destDir}.`;
      case "not a git repo":
        return `Next: not a git repo - files written at ${destDir}, will not ride a commit.`;
      default: {
        const detail = report.error ?? "unknown git error";
        if (report.staged.length > 0) {
          return (
            `Next: staging failed: ${detail} - ${report.staged.length} copied file(s) were ` +
            `staged before the failure (${report.staged.join(", ")}); stage the remaining ` +
            `files manually (git add <dest>) or move the skill home so it rides a commit.`
          );
        }
        return (
          `Next: staging failed: ${detail} - files written at ${destDir}; commit them ` +
          `manually (git add <dest>) or move the skill home so it rides a commit.`
        );
      }
    }
  }

  private textResult(text: string): AgentToolResult<unknown> {
    return {
      content: [{ type: "text", text }],
      details: undefined,
    };
  }
}

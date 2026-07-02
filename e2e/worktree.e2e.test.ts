/**
 * Integration tests for GitWorktreeProvider with a real git repository.
 *
 * These tests create a temporary git repo, commit a file so HEAD is clean,
 * then exercise createWorkspace / destroyWorkspace end-to-end. They verify
 * actual filesystem state and git worktree metadata, not mocked behaviour.
 *
 * Run via: `npm run test:e2e`
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GitWorktreeProvider } from "../src/workspace/GitWorktreeProvider";
import {
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "../src/workspace/WorkspaceError";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Run a command in the given directory, return trimmed stdout. */
function git(dir: string, args: string): string {
  return execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" }).trim();
}

/** Create a temp git repo with one committed file so HEAD is clean. */
function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-worktree-"));
  execSync("git init --initial-branch=main", { cwd: dir });
  execSync('git config user.email "test@forge.local"', { cwd: dir });
  execSync('git config user.name "Forge E2E"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test repo\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "initial commit"', { cwd: dir });
  return dir;
}

/** Full path to the worktree the provider would create. */
function expectedWorktreePath(repoRoot: string, workspaceId: string): string {
  return join(repoRoot, ".forge", "worktrees", workspaceId);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GitWorktreeProvider (e2e)", () => {
  let repoRoot: string;
  let provider: GitWorktreeProvider;

  beforeEach(() => {
    repoRoot = createTempRepo();
    provider = new GitWorktreeProvider(repoRoot);
  });

  afterEach(() => {
    // Best-effort cleanup: prune all worktrees, then remove the temp dir
    try {
      execSync("git worktree prune", { cwd: repoRoot });
    } catch {
      // ignore
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  // ── Happy path ──────────────────────────────────────────────────────

  it("creates and destroys a worktree", async () => {
    const workspacePath = await provider.createWorkspace("task-1");

    // Verify the directory exists and is a git repository
    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(join(workspacePath, ".git"))).toBe(true);

    // Verify the worktree is listed by git
    const listOutput = git(repoRoot, "worktree list --porcelain");
    expect(listOutput).toContain(workspacePath);

    // Verify the branch was created
    const branches = git(repoRoot, "branch --list forge/task-1");
    expect(branches).toContain("forge/task-1");

    // Destroy and verify cleanup
    await provider.destroyWorkspace(workspacePath);
    expect(existsSync(workspacePath)).toBe(false);

    // Worktree should no longer be listed
    const afterList = git(repoRoot, "worktree list --porcelain");
    expect(afterList).not.toContain(workspacePath);
  });

  it("creates a workspace with changes isolated from main repo", async () => {
    const workspacePath = await provider.createWorkspace("task-2");

    // Write a file inside the worktree
    writeFileSync(join(workspacePath, "feature.ts"), "export const x = 1;");

    // The file should NOT exist in the main repo
    expect(existsSync(join(repoRoot, "feature.ts"))).toBe(false);

    await provider.destroyWorkspace(workspacePath);
  });

  it("uses custom baseRef", async () => {
    // Create a new branch in the main repo
    git(repoRoot, "checkout -b develop");
    git(repoRoot, "checkout main");

    const p = new GitWorktreeProvider(repoRoot, "develop");
    const workspacePath = await p.createWorkspace("task-3");

    // The worktree should be on the develop branch
    const branch = git(workspacePath, "branch --show-current");
    expect(branch).toBe("forge/task-3");

    // revert checkout in main repo
    git(repoRoot, "branch -D develop");

    await p.destroyWorkspace(workspacePath);
  });

  // ── Error cases ─────────────────────────────────────────────────────

  it("allows creation when the main repo has uncommitted changes", async () => {
    // Dirty the working tree
    writeFileSync(join(repoRoot, "README.md"), "# modified\n");

    // git worktree creates from the commit, not the working tree, so a dirty
    // main repo must NOT block creation (deliberate change in PR #44).
    const workspacePath = await provider.createWorkspace("task-4");
    expect(existsSync(workspacePath)).toBe(true);

    // The dirty change stays in the main repo and does not leak into the worktree
    expect(existsSync(join(workspacePath, "README.md"))).toBe(true);
    const worktreeReadme = readFileSync(join(workspacePath, "README.md"), "utf-8");
    expect(worktreeReadme).toBe("# test repo\n");

    await provider.destroyWorkspace(workspacePath);
  });

  it("throws WorktreeBranchExistsError when branch already exists", async () => {
    // Create the same branch beforehand
    git(repoRoot, "branch forge/task-5");

    await expect(provider.createWorkspace("task-5")).rejects.toThrow(WorktreeBranchExistsError);
  });

  it("throws WorktreePathExistsError when path already exists", async () => {
    const stalePath = expectedWorktreePath(repoRoot, "task-6");
    // Manually create a git worktree to get a stale path
    git(repoRoot, `worktree add ${stalePath} HEAD`);
    // Manually remove the worktree metadata (but NOT the directory)
    git(repoRoot, `worktree remove ${stalePath} --force`);
    // Recreate the directory as if from a crash
    execSync(`mkdir -p ${stalePath}`);

    // Now the path exists but git doesn't know about it
    await expect(provider.createWorkspace("task-6")).rejects.toThrow(WorktreePathExistsError);
  });

  it("destroyWorkspace is idempotent", async () => {
    const workspacePath = await provider.createWorkspace("task-7");

    // First destroy
    await provider.destroyWorkspace(workspacePath);
    expect(existsSync(workspacePath)).toBe(false);

    // Second destroy — should not throw
    await expect(provider.destroyWorkspace(workspacePath)).resolves.toBeUndefined();
  });
});

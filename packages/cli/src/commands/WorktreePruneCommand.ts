import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { basename } from "node:path";
import { promisify } from "node:util";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ReconciliationReport } from "@feature-forge/core/src/workspace/WorktreeRegistry";

import { Command } from "./Command";

const execFileAsync = promisify(execFile);

/**
 * List or clean up stale worktree registry entries, orphaned worktree
 * directories, and orphaned `forge/*` branches.
 *
 * Usage:
 *   /forge:worktree:prune          — list stale items (read-only)
 *   /forge:worktree:prune --sweep  — remove all stale items (with confirmation)
 */
export class WorktreePruneCommand extends Command {
  readonly name = "worktree:prune";
  readonly description =
    "Prune stale worktrees and branches. Usage: /forge:worktree:prune [--sweep]";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const manager = this.workspaceManager;
    const registry = this.worktreeRegistry;
    if (!manager || !registry) {
      ctx.ui.notify("Workspace infrastructure is not configured.", "error");
      return;
    }

    const tokens = args.trim().split(/\s+/);
    const sweep = tokens.includes("--sweep");

    const repoRoot = process.cwd();
    const report = await registry.reconcile(repoRoot);
    const { staleRegistryEntries, orphanedWorktrees, orphanedBranches } = report;

    if (!sweep) {
      this.printReport(report, ctx);
      return;
    }

    // ── Sweep mode ─────────────────────────────────────────────────
    const total = staleRegistryEntries.length + orphanedWorktrees.length + orphanedBranches.length;
    if (total === 0) {
      ctx.ui.notify("✨ Nothing to prune — worktree state is clean.", "info");
      return;
    }

    const results: string[] = [];
    const deletedBranches = new Set<string>();

    // 1. Stale registry entries: destroy via manager (handles registry + provider).
    for (const path of staleRegistryEntries) {
      try {
        await manager.destroy(path);
        results.push(`✅ Removed stale registry entry: ${path}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        results.push(`❌ Failed to remove stale registry entry "${path}": ${message}`);
      }
    }

    // 2. Orphaned worktrees: remove directory and delete branch if forge/*.
    for (const path of orphanedWorktrees) {
      try {
        rmSync(path, { recursive: true, force: true });
        results.push(`✅ Removed orphaned worktree: ${path}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        results.push(`❌ Failed to remove orphaned worktree "${path}": ${message}`);
        continue;
      }

      // Try to delete the corresponding forge/* branch.
      const dirName = basename(path);
      const branch = `forge/${dirName}`;
      try {
        await execFileAsync("git", ["branch", "-D", branch], { cwd: repoRoot });
        deletedBranches.add(branch);
        results.push(`✅ Deleted branch: ${branch}`);
      } catch {
        // Branch may not exist or git may be unavailable — non-blocking.
      }
    }

    // 3. Orphaned branches: delete directly, skipping already-deleted ones.
    for (const branch of orphanedBranches) {
      if (deletedBranches.has(branch)) {
        continue;
      }
      try {
        await execFileAsync("git", ["branch", "-D", branch], { cwd: repoRoot });
        results.push(`✅ Deleted orphaned branch: ${branch}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        results.push(`❌ Failed to delete branch "${branch}": ${message}`);
      }
    }

    ctx.ui.notify(
      `🧹 Prune complete:\n${results.join("\n")}`,
      results.some((r) => r.startsWith("❌")) ? "error" : "info",
    );
  };

  private printReport(report: ReconciliationReport, ctx: ExtensionCommandContext): void {
    const { staleRegistryEntries, orphanedWorktrees, orphanedBranches } = report;

    if (
      staleRegistryEntries.length === 0 &&
      orphanedWorktrees.length === 0 &&
      orphanedBranches.length === 0
    ) {
      ctx.ui.notify("✨ No stale items — everything is clean.", "info");
      return;
    }

    const lines: string[] = [`📋 Reconciliation Report:`];

    if (staleRegistryEntries.length > 0) {
      lines.push(
        `  Stale registry entries (${staleRegistryEntries.length}):`,
        ...staleRegistryEntries.map((p) => `    • ${p}`),
      );
    }

    if (orphanedWorktrees.length > 0) {
      lines.push(
        `  Orphaned worktrees (${orphanedWorktrees.length}):`,
        ...orphanedWorktrees.map((p) => `    • ${p}`),
      );
    }

    if (orphanedBranches.length > 0) {
      lines.push(
        `  Orphaned branches (${orphanedBranches.length}):`,
        ...orphanedBranches.map((b) => `    • ${b}`),
      );
    }

    const total = staleRegistryEntries.length + orphanedWorktrees.length + orphanedBranches.length;
    lines.push(`  Run /forge:worktree:prune --sweep to clean up ${total} item(s).`);

    ctx.ui.notify(lines.join("\n"), "info");
  }
}

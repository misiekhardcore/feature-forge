import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

/**
 * Destroy a specific worktree by path.
 *
 * Usage: `/worktree:destroy <path>`
 *
 * Removes the worktree directory and the registry entry.
 */
export class WorktreeDestroyCommand extends Command {
  readonly name = "worktree:destroy";
  readonly description = "Destroy a worktree by path. Usage: /worktree:destroy <path>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const manager = this.workspaceManager;
    if (!manager) {
      ctx.ui.notify("Workspace infrastructure is not configured.", "error");
      return;
    }

    const path = args.trim();
    if (!path) {
      ctx.ui.notify("Usage: /worktree:destroy <path>", "error");
      return;
    }

    const handle = manager.get(path);
    if (!handle) {
      ctx.ui.notify(
        `No worktree found with path "${path}". Use /worktree:list to see active ones.`,
        "error",
      );
      return;
    }

    try {
      await manager.destroy(path);
      ctx.ui.notify(`🗑️ Worktree "${handle.path}" destroyed.`, "info");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      ctx.ui.notify(`Failed to destroy worktree "${path}": ${message}`, "error");
    }
  };
}

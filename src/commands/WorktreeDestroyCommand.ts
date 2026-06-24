import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

/**
 * Destroy a specific worktree by id.
 *
 * Usage: `/worktree:destroy <id>`
 *
 * Removes the worktree directory and the registry entry.
 */
export class WorktreeDestroyCommand extends Command {
  readonly name = "worktree:destroy";
  readonly description = "Destroy a worktree by id. Usage: /worktree:destroy <id>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const manager = this.workspaceManager;
    if (!manager) {
      ctx.ui.notify("Workspace infrastructure is not configured.", "error");
      return;
    }

    const id = args.trim();
    if (!id) {
      ctx.ui.notify("Usage: /worktree:destroy <id>", "error");
      return;
    }

    const handle = manager.get(id);
    if (!handle) {
      ctx.ui.notify(
        `No worktree found with id "${id}". Use /worktree:list to see active ones.`,
        "error",
      );
      return;
    }

    try {
      await manager.destroy(id);
      ctx.ui.notify(`Worktree "${id}" destroyed.`, "info");
      this.pi.sendMessage(
        {
          customType: "worktree_destroyed",
          content: `## 🗑️ Worktree destroyed\n\n**${id}** at \`${handle.path}\``,
          display: true,
        },
        { triggerTurn: false },
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      ctx.ui.notify(`Failed to destroy worktree "${id}": ${message}`, "error");
    }
  };
}

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

/**
 * Lists all active worktrees tracked by the registry.
 *
 * Usage: `/worktree:list`
 */
export class WorktreeListCommand extends Command {
  readonly name = "worktree:list";
  readonly description = "List all active worktrees. Usage: /worktree:list";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const manager = this.workspaceManager;
    if (!manager) {
      ctx.ui.notify("Workspace infrastructure is not configured.", "error");
      return;
    }

    const handles = manager.list();

    if (handles.length === 0) {
      ctx.ui.notify("No active worktrees.", "info");
      return;
    }

    const lines = handles.map((h) => {
      const age = Math.round((Date.now() - h.createdAt.getTime()) / 60000);
      return `  • ${h.path} (created ${age} min ago)`;
    });

    ctx.ui.notify(`Active worktrees (${handles.length}):\n${lines.join("\n")}`, "info");
  };
}

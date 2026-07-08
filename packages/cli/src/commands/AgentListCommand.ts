import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { Command } from "./Command";

/**
 * Opens the AgentViewerOverlay showing all tracked agents from the
 * supervisor. The overlay supports keyboard navigation (arrow keys,
 * Enter for detail, Esc to dismiss).
 */
export class AgentListCommand extends Command {
  readonly name = "agent:list";
  readonly description = "Open the agent viewer overlay with all tracked agents.";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const agents = this.supervisor.getAllAgents();
    if (agents.length === 0) {
      ctx.ui?.notify("No agents currently tracked.", "info");
      return;
    }

    const streamDir = mkdtempSync(join(tmpdir(), "forge-streams-"));

    await ctx.ui?.custom<void>(
      (tui, theme, _kb, done) => {
        const viewer = new AgentViewerOverlay(tui, theme, () => {
          try {
            rmSync(streamDir, { recursive: true, force: true });
          } catch {
            // Silent cleanup.
          }
          done();
        });

        viewer.setAgentExecutionId("agent-list", streamDir);

        for (const agent of agents) {
          const status = this.mapStatus(agent.status);
          viewer.update({
            id: agent.id,
            status,
            summary: `${agent.specification.role} — ${agent.status}`,
          });
        }

        return viewer;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: 80,
          maxHeight: 20,
        },
      },
    );
  };

  private mapStatus(status: AgentStatus): string {
    switch (status) {
      case AgentStatus.Spawned:
      case AgentStatus.Running:
        return "started";
      case AgentStatus.Completed:
        return "done";
      case AgentStatus.Failed:
      case AgentStatus.Cancelled:
        return "error";
    }
  }
}

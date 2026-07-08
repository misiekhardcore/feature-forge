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
          unsub();
          try {
            rmSync(streamDir, { recursive: true, force: true });
          } catch {
            // Silent cleanup.
          }
          done();
        });

        // Subscribe to agent stream events so the detail view shows
        // live tool calls, thinking, and results in real time.
        const unsub = this.pi.events.on("feature-forge:agent-stream", (data) => {
          const event = data as { details?: { agentId?: string; event?: unknown } };
          if (event.details?.agentId && event.details?.event) {
            viewer.pushStreamEvent(event.details.agentId, event.details.event);
          }
        });

        // Patch onDone to also unsubscribe from stream events.
        const originalDone = (viewer as unknown as Record<string, unknown>)["onDone"] as
          | (() => void)
          | undefined;
        (viewer as unknown as Record<string, unknown>)["onDone"] = () => {
          unsub();
          originalDone?.();
        };

        viewer.setAgentExecutionId("agent-list", streamDir);

        for (const agent of agents) {
          const status = this.mapStatus(agent.status);
          viewer.update({
            id: agent.id,
            status,
            summary: `${agent.specification.role} — ${agent.status}`,
            elapsed: this.formatElapsed(agent.createdAt),
          });
        }

        return viewer;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "100%",
          maxHeight: "95%",
          margin: 1,
        },
      },
    );
  };

  private formatElapsed(createdAt: Date): string {
    const ms = Date.now() - createdAt.getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

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

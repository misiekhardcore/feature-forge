import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import { logger } from "../logging";
import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { getSharedStreamDir } from "../orchestrator/progress/sharedStreamDir";
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

    const streamDir = getSharedStreamDir();
    process.once("exit", () => {
      try {
        rmSync(streamDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    });

    // Holder so finally block can unsubscribe even if ctx.ui.custom throws.
    let unsub: (() => void) | undefined;

    try {
      await ctx.ui?.custom<void>(
        (tui, theme, _kb, done) => {
          // Buffer events delivered between subscription and viewer creation
          // so none are dropped during the synchronous construction gap.
          const eventBuffer: Array<{ agentId: string; event: AgentEvent }> = [];

          // let required because the subscription closure references viewer
          // before it is assigned to the constructor result.
          // eslint-disable-next-line prefer-const
          let viewer: AgentViewerOverlay;

          unsub = this.pi.events.on("feature-forge:agent-stream", (data) => {
            const payload = data as { details?: { agentId?: string; event?: unknown } };
            if (payload.details?.agentId && payload.details?.event) {
              if (viewer) {
                viewer.pushStreamEvent(
                  payload.details.agentId,
                  payload.details.event as AgentEvent,
                );
              } else {
                eventBuffer.push({
                  agentId: payload.details.agentId,
                  event: payload.details.event as AgentEvent,
                });
              }
            }
          });

          viewer = new AgentViewerOverlay(tui, theme, () => {
            unsub?.();
            unsub = undefined;
            try {
              rmSync(streamDir, { recursive: true, force: true });
            } catch (err) {
              logger.debug("Agent viewer stream cleanup failed", { streamDir, err });
            }
            done();
          });

          // Replay buffered events into the now-ready viewer.
          for (const { agentId, event } of eventBuffer) {
            viewer.pushStreamEvent(agentId, event);
          }

          viewer.setStreamDir(streamDir);

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
    } finally {
      unsub?.();
    }
  };

  private formatElapsed(createdAt: Date): string {
    if (!createdAt) return "—";
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
      default:
        return "unknown";
    }
  }
}

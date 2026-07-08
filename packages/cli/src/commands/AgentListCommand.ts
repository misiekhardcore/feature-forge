import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { logger } from "../logging";
import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { SharedStreamDir } from "../orchestrator/progress/sharedStreamDir";
import { Command } from "./Command";

/** Channels the overlay needs for live updates. */
const OVERLAY_CHANNELS = [
  "feature-forge:agent-stream",
  "feature-forge:agent-started",
  "feature-forge:agent-done",
] as const;

/**
 * Opens the AgentViewerOverlay showing all tracked agents from the
 * supervisor. The overlay supports keyboard navigation (arrow keys,
 * Enter for detail, Esc to dismiss).
 *
 * Creates the overlay synchronously inside {@code ctx.ui.custom},
 * subscribes to live agent events, and populates initial agent entries
 * from the supervisor.
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

    const streamDir = SharedStreamDir.get();
    let cleanup: (() => void) | undefined;

    try {
      await ctx.ui?.custom<void>(
        (tui, theme, _kb, done) => {
          // Buffer events delivered between subscription and viewer creation
          // so none are dropped during the synchronous construction gap.
          const eventBuffer: Array<{ agentId: string; event: AgentEvent; status?: string }> = [];

          // let required because subscription closures reference viewer
          // before constructor assignment.
          // eslint-disable-next-line prefer-const
          let viewer: AgentViewerOverlay;

          const unsubs = OVERLAY_CHANNELS.map((channel) =>
            this.pi.events.on(channel, (data) => {
              const payload = data as {
                details?: { agentId?: string; event?: unknown; status?: string };
              };
              const agentId = payload.details?.agentId;
              if (!agentId) return;

              if (channel === "feature-forge:agent-stream" && payload.details?.event) {
                const event = payload.details.event as AgentEvent;
                if (viewer) {
                  viewer.pushStreamEvent(agentId, event);
                } else {
                  eventBuffer.push({ agentId, event });
                }
              }

              if (
                channel === "feature-forge:agent-started" ||
                channel === "feature-forge:agent-done"
              ) {
                const status = channel === "feature-forge:agent-started" ? "started" : "done";
                if (viewer) {
                  viewer.update({ id: agentId, status });
                } else {
                  eventBuffer.push({
                    agentId,
                    event: { type: "agent_start" },
                    status,
                  });
                }
              }
            }),
          );

          const dismiss = () => {
            for (const unsub of unsubs) unsub();
            viewer.dispose();
            done();
          };

          viewer = new AgentViewerOverlay(tui, theme, dismiss);

          // Replay buffered events.
          for (const item of eventBuffer) {
            if (item.status) {
              viewer.update({ id: item.agentId, status: item.status });
            } else {
              viewer.pushStreamEvent(item.agentId, item.event);
            }
          }

          viewer.setStreamDir(streamDir);

          // Populate initial agent entries from supervisor.
          for (const agent of agents) {
            const status = AgentViewerOverlay.mapStatus(agent.status);
            viewer.update({
              id: agent.id,
              status,
              summary: `${agent.specification.role} — ${agent.status}`,
              elapsed: AgentViewerOverlay.formatElapsed(agent.createdAt),
            });
          }

          cleanup = dismiss;
          return viewer;
        },
        {
          overlay: true,
          overlayOptions: AgentViewerOverlay.overlayOptions,
        },
      );
    } catch (err) {
      logger.debug("Agent viewer overlay creation failed", { err });
    } finally {
      cleanup?.();
    }
  };
}

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { logger } from "../logging";
import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { SharedStreamDir } from "../orchestrator/progress/sharedStreamDir";
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

    if (ctx.hasUI) {
      let overlayCleanup: (() => void) | undefined;
      let viewerDismiss: (() => void) | undefined;
      const streamDir = SharedStreamDir.get();
      await ctx.ui
        .custom<void>(
          (tui, theme, _kb, done) => {
            viewerDismiss = done;

            const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
              eventBus: this.pi.events,
              supervisor: this.supervisor,
            });

            const viewer = new AgentViewerOverlay(tui, theme, () => {
              unsubs.forEach((u) => u());
              viewer.dispose();
              done();
            });

            connect(viewer, streamDir);

            overlayCleanup = () => {
              unsubs.forEach((u) => u());
              viewer.dispose();
            };

            return viewer;
          },
          {
            overlay: true,
            overlayOptions: AgentViewerOverlay.overlayOptions,
          },
        )
        .catch((err) => {
          logger.debug("Agent viewer overlay creation failed", { err });
        })
        .finally(() => {
          overlayCleanup?.();
          viewerDismiss?.();
        });
    }
  };
}

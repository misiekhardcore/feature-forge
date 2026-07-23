import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/shared";
import { AgentViewerOverlay } from "@feature-forge/tui";

import { TypedEventBus } from "../orchestrator/eventBus";
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
    if (ctx.hasUI) {
      let overlayCleanup: (() => void) | undefined;
      let viewerDismiss: (() => void) | undefined;
      const streamDir = SharedStreamDir.get(ForgeConfig.getInstance().getLogDir());
      await ctx.ui
        .custom<void>(
          (tui, theme, _kb, done) => {
            viewerDismiss = done;

            const typedBus = new TypedEventBus(this.pi.events);

            const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
              eventBus: typedBus,
              agentQuery: this.supervisor,
              config: ForgeConfig.getInstance(),
              toolRegistry: this.toolRegistry,
            });

            const viewer = new AgentViewerOverlay({
              tui,
              theme,
              onDone: () => {
                unsubs.forEach((u) => u());
                viewer.dispose();
                done();
              },
              markdownTheme: getMarkdownTheme(),
              cwd: ctx.cwd,
              toolRegistry: this.toolRegistry,
              config: ForgeConfig.getInstance(),
            });

            void connect(viewer, streamDir);

            overlayCleanup = () => {
              unsubs.forEach((u) => u());
              viewer.dispose();
            };

            return viewer;
          },
          {
            overlay: true,
            overlayOptions: AgentViewerOverlay.getOverlayOptions(),
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

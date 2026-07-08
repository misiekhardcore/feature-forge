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

    const streamDir = SharedStreamDir.get();
    let cleanup: (() => void) | undefined;

    try {
      await ctx.ui?.custom<void>(
        (tui, theme, _kb, done) => {
          const result = AgentViewerOverlay.mount({
            supervisor: this.supervisor,
            eventBus: this.pi.events,
            streamDir,
            tui,
            theme,
            onDone: done,
          });
          cleanup = result.cleanup;
          return result.viewer;
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

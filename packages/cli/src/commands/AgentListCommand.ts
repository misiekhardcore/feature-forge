import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ForgeConfigData } from "@feature-forge/core";
import { logger } from "@feature-forge/core";
import type { AgentSupervisor } from "@feature-forge/core/agents";
import { Command } from "@feature-forge/core/commands";
import { TypedEventBus } from "@feature-forge/core/event-bus";

import { AgentViewerConfig } from "../tui/AgentViewerConfig";
import { showAgentViewer } from "../tui/showAgentViewer";

/**
 * Opens the AgentViewerOverlay showing all tracked agents from the
 * supervisor. The overlay supports keyboard navigation (arrow keys,
 * Enter for detail, Esc to dismiss).
 */
export class AgentListCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
  // The resolved forge config — CommandRegistry always supplies it via the deps bag.
  declare protected readonly config: Readonly<ForgeConfigData>;
  readonly name = "agent:list";
  readonly description = "Open the agent viewer overlay with all tracked agents.";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const toolRegistry = this.toolRegistry;
    if (!toolRegistry) {
      ctx.ui.notify("Tool registry not available — agent viewer cannot open.", "error");
      return;
    }

    if (ctx.hasUI) {
      await showAgentViewer({
        ctx,
        config: new AgentViewerConfig(this.config, ctx.cwd),
        toolRegistry,
        eventBus: new TypedEventBus(this.pi.events),
        agentQuery: this.supervisor,
      }).catch((err) => {
        logger.debug("Agent viewer overlay creation failed", { err });
      });
    }
  };
}

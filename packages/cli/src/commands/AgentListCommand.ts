import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/shared";

import { type AgentSupervisor, showAgentViewer } from "../agents";
import { TypedEventBus } from "../orchestrator/eventBus";
import { Command } from "./Command";

/**
 * Opens the AgentViewerOverlay showing all tracked agents from the
 * supervisor. The overlay supports keyboard navigation (arrow keys,
 * Enter for detail, Esc to dismiss).
 */
export class AgentListCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
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
        config: ForgeConfig.getInstance(),
        toolRegistry,
        eventBus: new TypedEventBus(this.pi.events),
        agentQuery: this.supervisor,
      }).catch((err) => {
        logger.debug("Agent viewer overlay creation failed", { err });
      });
    }
  };
}

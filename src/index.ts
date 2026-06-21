import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { InMemoryAgentSupervisor, PiSubprocessAgentFactory } from "./agents";
import { CommandRegistry } from "./registry";
import {
  AgentListCommand,
  AgentDestroyCommand,
  AgentDestroyAllCommand,
  ResearchCommand,
} from "./commands";

const featureForgeExtension: ExtensionFactory = (pi) => {
  const supervisor = new InMemoryAgentSupervisor(new PiSubprocessAgentFactory());

  const cmdRegistry = new CommandRegistry({ supervisor, pi });

  cmdRegistry.registerAll([
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    ResearchCommand,
  ]);

  // ToolRegistry ready for future tools
  // const toolRegistry = new ToolRegistry({ pi });
};

export default featureForgeExtension;

import type { ExtensionFactory, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { InMemoryAgentSupervisor, PiSubprocessAgentFactory } from "./agents/index.js";
import { ResearchAgentSpecification } from "./specifications/ResearchAgentSpecification.js";

const featureForgeExtension: ExtensionFactory = (pi) => {
  const supervisor = new InMemoryAgentSupervisor(new PiSubprocessAgentFactory());

  function formatAgentLine(agent: {
    identifier: { toString(): string };
    status: string;
    specification: { role: string };
  }): string {
    return `  • ${agent.identifier} — ${agent.status} (role: ${agent.specification.role})`;
  }

  pi.registerCommand("agent:list", {
    description: "List all tracked subagents and their current status.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const agents = supervisor.getAllAgents();
      if (agents.length === 0) {
        ctx.ui.notify("No agents currently tracked.", "info");
        return;
      }

      const lines = agents.map(formatAgentLine);
      ctx.ui.notify(`Tracked agents (${agents.length}):\n${lines.join("\n")}`, "info");
    },
  });

  pi.registerCommand("agent:destroy", {
    description: "Destroy a specific subagent. Usage: /agent:destroy <name>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const name = args.trim();
      if (!name) {
        ctx.ui.notify("Usage: /agent:destroy <name>", "error");
        return;
      }

      await supervisor.destroyAgent(name);
      ctx.ui.notify(`Agent "${name}" destroyed.`, "info");
    },
  });

  pi.registerCommand("agent:destroy-all", {
    description: "Destroy all tracked subagents.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const count = supervisor.getAllAgents().length;
      await supervisor.destroyAll();
      ctx.ui.notify(`All ${count} agent(s) destroyed.`, "info");
    },
  });

  pi.registerCommand("research", {
    description:
      "Spawn a research subagent to investigate a topic in the background. " +
      "Usage: /research <topic>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const topic = args.trim();
      if (!topic) {
        ctx.ui.notify("Usage: /research <topic>", "error");
        return;
      }

      const specification = new ResearchAgentSpecification();

      ctx.ui.notify(`Research agent investigating "${topic}" in the background...`, "info");

      supervisor.runAgent(specification, topic, pi);
    },
  });
};

export default featureForgeExtension;

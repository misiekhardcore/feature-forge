import { ExtensionFactory, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  AgentIdentifier,
  AgentSpecification,
  InMemoryAgentSupervisor,
  PiSubprocessAgentFactory,
} from "./agents/index.js";

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

      const specification = new (class extends AgentSpecification {
        constructor() {
          super({
            identifier: new AgentIdentifier("researcher"),
            role: "researcher",
            systemPrompt:
              "You are a research agent. Investigate the given topic thoroughly. " +
              "Use available tools to search, read, and gather information. " +
              "Return a structured summary with:\n" +
              "- Key findings\n" +
              "- Relevant details or data points\n" +
              "- Open questions or uncertainties\n\n" +
              "Format your response as clean markdown.",
          });
        }
      })();

      ctx.ui.notify(`Research agent investigating "${topic}" in the background...`, "info");

      supervisor
        .spawn(specification)
        .then(async (agent) => {
          const result = await agent.executeTask(topic);

          const summary =
            typeof result === "object" && result !== null
              ? "_(research complete, see details above)_"
              : String(result);

          pi.sendMessage(
            {
              customType: "research_result" as const,
              content: `## 🔍 Research: ${topic}\n\n${summary}`,
              display: true,
            },
            { triggerTurn: false },
          );
        })
        .catch(async (error: Error) => {
          pi.sendMessage(
            {
              customType: "research_error" as const,
              content: `## ❌ Research failed: ${topic}\n\n${error instanceof Error ? error.message : String(error)}`,
              display: true,
            },
            { triggerTurn: false },
          );
        });
    },
  });
};

export default featureForgeExtension;

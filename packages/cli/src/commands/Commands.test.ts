import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionAgent } from "../agents/agents/SessionAgent";
import { DynamicAgentSpecification, SpecRegistry } from "../agents/specifications";
import { TOOL_PRESETS } from "../agents/specifications/constants";
import { SpecManager } from "../agents/SpecManager";
import { InMemoryAgentSupervisor } from "../agents/supervisors";
import { SpecLoader } from "../loaders/SpecLoader";
import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockSpecManager,
  makeMockToolRegistry,
  makeSpec,
  MockWorkspaceProvider,
  MockWorktreeRegistry,
  toolListToRestrictions,
} from "../test-utils";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import { AgentDestroyAllCommand } from "./AgentDestroyAllCommand";
import { AgentDestroyCommand } from "./AgentDestroyCommand";
import { AgentListCommand } from "./AgentListCommand";
import { FlowExitCommand } from "./FlowExitCommand";
import { ResearchCommand } from "./ResearchCommand";

const pi = makeMockPi();

function makeWorkspaceManager(): WorkspaceManager {
  return new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry());
}

describe("ResearchCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: ResearchCommand;
  let ctx: ExtensionCommandContext;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    const registry = new SpecRegistry();
    registry.register(
      "research",
      (params) =>
        new DynamicAgentSpecification({
          id: "research",
          role: "researcher",
          systemPrompt: `Research: ${params.CONTEXT ?? ""}`,
          toolRestrictions: toolListToRestrictions(TOOL_PRESETS.readOnly),
          ephemeral: true,
        }),
    );
    const specManager = new SpecManager(registry, new SpecLoader());
    cmd = new ResearchCommand(supervisor, pi, specManager, makeMockToolRegistry());
    ctx = makeMockCtx();
  });

  it("has name 'research'", () => {
    expect(cmd.name).toBe("research");
  });

  it("notifies error when args is empty", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /research <topic>", "error");
  });

  it("notifies error when args is whitespace", async () => {
    await cmd.handler("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /research <topic>", "error");
  });

  it("triggers supervisor.runAgent with trimmed topic", async () => {
    vi.spyOn(supervisor, "runAgent").mockResolvedValue(undefined);
    await cmd.handler("  quantum computing  ", ctx);
    expect(supervisor.runAgent).toHaveBeenCalledWith(
      expect.any(Object),
      "quantum computing",
      expect.any(Object),
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Research agent investigating "quantum computing" in the background...',
      "info",
    );
  });
});

describe("AgentListCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentListCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentListCommand(supervisor, pi, makeMockSpecManager(), makeMockToolRegistry());
    ctx = makeMockCtx();
  });

  it("has name 'agent:list'", () => {
    expect(cmd.name).toBe("agent:list");
  });

  it("opens overlay even when no agents are tracked", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        overlay: true,
        overlayOptions: expect.objectContaining({ anchor: "center" }),
      }),
    );
  });

  it("opens overlay via ctx.ui.custom when agents are tracked", async () => {
    await supervisor.spawnGuest(makeSpec("a1", { role: "worker" }));
    await cmd.handler("", ctx);
    expect(ctx.ui.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        overlay: true,
        overlayOptions: expect.objectContaining({ anchor: "center" }),
      }),
    );
  });
});

describe("AgentDestroyCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentDestroyCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentDestroyCommand(supervisor, pi, makeMockSpecManager(), makeMockToolRegistry());
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy'", () => {
    expect(cmd.name).toBe("agent:destroy");
  });

  it("notifies error when args is empty", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /agent:destroy <name>", "error");
  });

  it("calls supervisor.destroyAgent and notifies", async () => {
    vi.spyOn(supervisor, "destroyAgent").mockResolvedValue(undefined);
    await cmd.handler("agent-1", ctx);
    expect(supervisor.destroyAgent).toHaveBeenCalledWith("agent-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith('🗑️ Agent "agent-1" destroyed.', "info");
  });
});

describe("AgentDestroyAllCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentDestroyAllCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentDestroyAllCommand(supervisor, pi, makeMockSpecManager(), makeMockToolRegistry());
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy-all'", () => {
    expect(cmd.name).toBe("agent:destroy-all");
  });

  it("calls supervisor.destroyAll and notifies with count", async () => {
    await supervisor.spawnGuest(makeSpec("a1"));
    await supervisor.spawnGuest(makeSpec("a2"));
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 2 agent(s) destroyed.", "info");
  });

  it("notifies 0 when no agents", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 0 agent(s) destroyed.", "info");
  });
});

describe("FlowExitCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    ctx = makeMockCtx();
  });

  describe("without workspace manager", () => {
    let cmd: FlowExitCommand;

    beforeEach(() => {
      cmd = new FlowExitCommand(supervisor, pi, makeMockSpecManager(), makeMockToolRegistry());
    });

    it("has name 'flow:exit'", () => {
      expect(cmd.name).toBe("flow:exit");
    });

    it("notifies when no active flow is mounted", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Flow exited. No active flow to exit.", "info");
    });

    it("unmounts agents and sends exit message when a session agent is mounted", async () => {
      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = (await supervisor.mountInSession(spec)) as SessionAgent;
      agent.mount(pi, "start task");

      await cmd.handler("", ctx);

      expect(agent.isMounted).toBe(false);
      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Flow exited. Ready."),
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
    });
  });

  describe("with workspace manager", () => {
    let workspaceManager: WorkspaceManager;
    let cmd: FlowExitCommand;

    beforeEach(() => {
      workspaceManager = makeWorkspaceManager();
      cmd = new FlowExitCommand(
        supervisor,
        pi,
        makeMockSpecManager(),
        makeMockToolRegistry(),
        workspaceManager,
      );
    });

    it("destroys active workspaces after unmounting agents", async () => {
      const handle = await workspaceManager.create("task-1");
      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = (await supervisor.mountInSession(spec)) as SessionAgent;
      agent.mount(pi, "start task");

      await cmd.handler("", ctx);

      expect(destroySpy).toHaveBeenCalledWith(handle.path);
      expect(agent.isMounted).toBe(false);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
    });

    it("skips workspace cleanup when list is empty", async () => {
      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = (await supervisor.mountInSession(spec)) as SessionAgent;
      agent.mount(pi, "start task");

      await cmd.handler("", ctx);

      expect(destroySpy).not.toHaveBeenCalled();
      expect(agent.isMounted).toBe(false);
    });

    it("continues unmounting agents when workspace destroy fails (best-effort)", async () => {
      await workspaceManager.create("task-1");
      await workspaceManager.create("task-2");

      // Make destroy fail only on the first workspace.
      const origDestroy = workspaceManager.destroy.bind(workspaceManager);
      let callCount = 0;
      workspaceManager.destroy = async (id: string) => {
        callCount++;
        if (callCount === 1) throw new Error("cleanup failure");
        return origDestroy(id);
      };

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = (await supervisor.mountInSession(spec)) as SessionAgent;
      agent.mount(pi, "start task");

      await cmd.handler("", ctx);

      // Both workspace destroys were attempted.
      expect(callCount).toBe(2);
      // Agent still got unmounted despite the error.
      expect(agent.isMounted).toBe(false);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
    });
  });
});

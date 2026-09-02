import { logger } from "@feature-forge/core";
import { InMemoryAgentSupervisor } from "@feature-forge/core/agents";
import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import { FlowStateStore } from "@feature-forge/core/flows";
import { WorkspaceManager } from "@feature-forge/core/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockSpecManager,
  makeMockToolRegistry,
  makeSpec,
  MockWorkspaceProvider,
  MockWorktreeRegistry,
} from "../test-utils";
import { AgentListCommand } from "./AgentListCommand";
import { FlowExitCommand } from "./FlowExitCommand";

const pi = makeMockPi();

function makeWorkspaceManager(): WorkspaceManager {
  return new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry());
}

describe("AgentListCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentListCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentListCommand({
      supervisor,
      pi,
      specManager: makeMockSpecManager(),
      toolRegistry: makeMockToolRegistry(),
    });
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

  it("does not open the overlay when the session has no UI", async () => {
    const noUiCtx = { ...ctx, hasUI: false };
    await cmd.handler("", noUiCtx);
    expect(noUiCtx.ui.custom).not.toHaveBeenCalled();
  });

  it("notifies an error and skips the overlay when the tool registry is missing", async () => {
    const noRegistryCmd = new AgentListCommand({
      supervisor,
      pi,
      specManager: makeMockSpecManager(),
      toolRegistry: undefined,
    });
    await noRegistryCmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Tool registry not available — agent viewer cannot open.",
      "error",
    );
    expect(ctx.ui.custom).not.toHaveBeenCalled();
  });

  it("logs and swallows overlay creation failures", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const failingCtx = makeMockCtx();
      (failingCtx.ui.custom as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
      await expect(cmd.handler("", failingCtx)).resolves.toBeUndefined();
      expect(debugSpy).toHaveBeenCalledWith(
        "Agent viewer overlay creation failed",
        expect.objectContaining({ err: expect.any(Error) }),
      );
    } finally {
      debugSpy.mockRestore();
    }
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
      cmd = new FlowExitCommand({ supervisor, pi });
    });

    it("has name 'flow:exit'", () => {
      expect(cmd.name).toBe("flow:exit");
    });

    it("notifies when no active flow is mounted", async () => {
      // A stale pointer (e.g. left by a prior session) must be cleared —
      // "No active flow to exit" is still a successful exit (AC5).
      const activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      const cmd = new FlowExitCommand({ supervisor, pi, activeFlow });

      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Flow exited. No active flow to exit.", "info");
      expect(activeFlow.getStore()).toBeUndefined();
    });

    it("destroys agents via supervisor and sends exit message when a session agent is mounted", async () => {
      const activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      const cmd = new FlowExitCommand({ supervisor, pi, activeFlow });

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);
      agent.mount(pi, "start task");

      const destroySpy = vi.spyOn(supervisor, "destroyAgent");

      await cmd.handler("", ctx);

      expect(destroySpy).toHaveBeenCalledWith(agent.id);
      expect(agent.isMounted).toBe(false);
      expect(pi.sendUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("Flow exited. Ready."),
        { deliverAs: "followUp" },
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
      // Successful exit clears the active flow (AC5) — subsequent
      // set_flow_param calls must fail until a new flow mounts.
      expect(activeFlow.getStore()).toBeUndefined();
    });

    it("notifies error and skips exit message when some agents fail to destroy", async () => {
      const activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      const cmd = new FlowExitCommand({ supervisor, pi, activeFlow });

      const spec1 = makeSpec("orchestrator-1", { role: "orchestrator" });
      const agent1 = await supervisor.mountInSession(spec1);
      agent1.mount(pi, "start task 1");

      const spec2 = makeSpec("orchestrator-2", { role: "orchestrator" });
      const agent2 = await supervisor.mountInSession(spec2);
      agent2.mount(pi, "start task 2");

      // First agent's destroy fails, second one succeeds (call-through).
      const origDestroy = supervisor.destroyAgent.bind(supervisor);
      const destroySpy = vi
        .spyOn(supervisor, "destroyAgent")
        .mockImplementation(async (id: string) => {
          if (id === agent1.id) {
            throw new Error("cleanup failure");
          }
          return origDestroy(id);
        });

      // Clear accumulated spy state so assertions cover handler calls only.
      vi.mocked(pi.sendUserMessage).mockClear();

      await cmd.handler("", ctx);

      // Both agents were destroyed (attempted) — the second succeeded.
      expect(destroySpy).toHaveBeenCalledTimes(2);
      expect(destroySpy).toHaveBeenCalledWith(agent1.id);
      expect(destroySpy).toHaveBeenCalledWith(agent2.id);
      expect(agent1.isMounted).toBe(true);
      expect(agent2.isMounted).toBe(false);
      // Error notification with count; no success notification, no LLM exit message.
      expect(ctx.ui.notify).toHaveBeenCalledWith("Flow exited with 1 error(s).", "error");
      expect(ctx.ui.notify).not.toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      // Failed exit does NOT clear the active flow (AC5).
      expect(activeFlow.getStore()).toBeDefined();
    });

    it("notifies error and skips exit message when all agents fail to destroy", async () => {
      const activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      const cmd = new FlowExitCommand({ supervisor, pi, activeFlow });

      const spec1 = makeSpec("orchestrator-1", { role: "orchestrator" });
      const agent1 = await supervisor.mountInSession(spec1);
      agent1.mount(pi, "start task 1");

      const spec2 = makeSpec("orchestrator-2", { role: "orchestrator" });
      const agent2 = await supervisor.mountInSession(spec2);
      agent2.mount(pi, "start task 2");

      const destroySpy = vi
        .spyOn(supervisor, "destroyAgent")
        .mockRejectedValue(new Error("cleanup failure"));

      vi.mocked(pi.sendUserMessage).mockClear();

      await cmd.handler("", ctx);

      // Both destroy attempts happened and both failed — agents stay mounted.
      expect(destroySpy).toHaveBeenCalledTimes(2);
      expect(destroySpy).toHaveBeenCalledWith(agent1.id);
      expect(destroySpy).toHaveBeenCalledWith(agent2.id);
      expect(agent1.isMounted).toBe(true);
      expect(agent2.isMounted).toBe(true);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Flow exited with 2 error(s).", "error");
      expect(ctx.ui.notify).not.toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      // Failed exit does NOT clear the active flow (AC5).
      expect(activeFlow.getStore()).toBeDefined();
    });

    it("normalizes non-Error throws during destroy", async () => {
      const activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      const cmd = new FlowExitCommand({ supervisor, pi, activeFlow });

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);
      agent.mount(pi, "start task");

      const destroySpy = vi.spyOn(supervisor, "destroyAgent").mockRejectedValue("boom");

      vi.mocked(pi.sendUserMessage).mockClear();

      await cmd.handler("", ctx);

      expect(destroySpy).toHaveBeenCalledWith(agent.id);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Flow exited with 1 error(s).", "error");
      expect(ctx.ui.notify).not.toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
      // Failed exit does NOT clear the active flow (AC5).
      expect(activeFlow.getStore()).toBeDefined();
    });
  });

  describe("with workspace manager", () => {
    let workspaceManager: WorkspaceManager;
    let cmd: FlowExitCommand;

    let activeFlow: ActiveFlowRegistry;

    beforeEach(() => {
      workspaceManager = makeWorkspaceManager();
      activeFlow = new ActiveFlowRegistry();
      activeFlow.setCurrent("implement", new FlowStateStore());
      cmd = new FlowExitCommand({ supervisor, pi, workspaceManager, activeFlow });
    });

    it("destroys active workspaces after unmounting agents", async () => {
      const handle = await workspaceManager.create("task-1");
      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);
      agent.mount(pi, "start task");

      await cmd.handler("", ctx);

      expect(destroySpy).toHaveBeenCalledWith(handle.path);
      expect(agent.isMounted).toBe(false);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Flow exited. Default system prompt and tools restored.",
        "info",
      );
      // Successful exit clears the active flow even with workspace cleanup.
      expect(activeFlow.getStore()).toBeUndefined();
    });

    it("skips workspace cleanup when list is empty", async () => {
      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);
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
      const agent = await supervisor.mountInSession(spec);
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

    it("only destroys workspaces created after agent snapshot", async () => {
      // Pre-existing workspace before snapshot
      const preExisting = await workspaceManager.create("preexisting");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);

      // Snapshot captures only the pre-existing workspace
      agent.snapshotWorkspaces(workspaceManager);

      // Mount the agent
      agent.mount(pi, "start task");

      // New workspace created after snapshot
      const newWs = await workspaceManager.create("new-workspace");

      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      await cmd.handler("", ctx);

      // Only the new workspace should be destroyed
      expect(destroySpy).toHaveBeenCalledWith(newWs.path);
      expect(destroySpy).not.toHaveBeenCalledWith(preExisting.path);
      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(agent.isMounted).toBe(false);
    });

    it("destroys all workspaces when snapshot was never taken (safety fallback)", async () => {
      const ws1 = await workspaceManager.create("task-1");
      const ws2 = await workspaceManager.create("task-2");

      const spec = makeSpec("orchestrator", { role: "orchestrator" });
      const agent = await supervisor.mountInSession(spec);
      // No snapshotWorkspaces call — simulates non-orchestrator agent
      agent.mount(pi, "start task");

      const destroySpy = vi.spyOn(workspaceManager, "destroy");

      await cmd.handler("", ctx);

      // Both workspaces destroyed (degenerate to old behavior)
      expect(destroySpy).toHaveBeenCalledWith(ws1.path);
      expect(destroySpy).toHaveBeenCalledWith(ws2.path);
      expect(destroySpy).toHaveBeenCalledTimes(2);
    });
  });
});

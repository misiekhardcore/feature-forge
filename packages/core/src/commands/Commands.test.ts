import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DynamicAgentSpecification, SpecRegistry } from "../agents/specifications";
import { TOOL_PRESETS } from "../agents/specifications/constants";
import { SpecLoader } from "../agents/specifications/SpecLoader";
import { SpecManager } from "../agents/SpecManager";
import { InMemoryAgentSupervisor } from "../agents/supervisors";
import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockToolRegistry,
  makeSpec,
  toolListToRestrictions,
} from "../test-utils";
import { AgentDestroyAllCommand } from "./AgentDestroyAllCommand";
import { AgentDestroyCommand } from "./AgentDestroyCommand";
import { ResearchCommand } from "./ResearchCommand";

const pi = makeMockPi();

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
    cmd = new ResearchCommand({
      supervisor,
      pi,
      specManager,
      toolRegistry: makeMockToolRegistry(),
    });
    ctx = makeMockCtx();
  });

  it("has name 'research'", () => {
    expect(cmd.name).toBe("research");
  });

  it("notifies error when args is empty", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /forge:research <topic>", "error");
  });

  it("notifies error when args is whitespace", async () => {
    await cmd.handler("   ", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /forge:research <topic>", "error");
  });

  it("notifies error when specManager is unavailable", async () => {
    const runAgentSpy = vi.spyOn(supervisor, "runAgent").mockResolvedValue(undefined);
    const noSpecManager = new ResearchCommand({ supervisor, pi });
    await noSpecManager.handler("topic", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "SpecManager not available — research spec cannot be loaded.",
      "error",
    );
    expect(runAgentSpy).not.toHaveBeenCalled();
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

describe("AgentDestroyCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentDestroyCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentDestroyCommand({ supervisor, pi });
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy'", () => {
    expect(cmd.name).toBe("agent:destroy");
  });

  it("notifies error when args is empty", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /forge:agent:destroy <name>", "error");
  });

  it("calls supervisor.destroyAgent and notifies", async () => {
    vi.spyOn(supervisor, "destroyAgent").mockResolvedValue(undefined);
    await cmd.handler("agent-1", ctx);
    expect(supervisor.destroyAgent).toHaveBeenCalledWith("agent-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith('🗑️ Agent "agent-1" destroyed.', "info");
  });

  it("refuses to destroy an in-session agent, notifying to use flow:exit", async () => {
    const persona = await supervisor.mountInSession(
      makeSpec("orchestrator", { role: "orchestrator" }),
    );
    const destroySpy = vi.spyOn(supervisor, "destroyAgent");
    const personaDestroySpy = vi.spyOn(persona, "destroy");

    await cmd.handler("orchestrator", ctx);

    expect(destroySpy).not.toHaveBeenCalled();
    expect(personaDestroySpy).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Agent "orchestrator" is an in-session agent - use /forge:flow:exit to end the flow.',
      "error",
    );
  });
});

describe("AgentDestroyAllCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: AgentDestroyAllCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    cmd = new AgentDestroyAllCommand({ supervisor, pi });
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy-all'", () => {
    expect(cmd.name).toBe("agent:destroy-all");
  });

  it("destroys each subprocess agent via destroyAgent and notifies with count", async () => {
    await supervisor.spawnGuest(makeSpec("a1"));
    await supervisor.spawnGuest(makeSpec("a2"));
    const destroySpy = vi.spyOn(supervisor, "destroyAgent");
    await cmd.handler("", ctx);
    expect(destroySpy).toHaveBeenCalledTimes(2);
    expect(destroySpy).toHaveBeenCalledWith("a1");
    expect(destroySpy).toHaveBeenCalledWith("a2");
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 2 agent(s) destroyed.", "info");
  });

  it("counts and destroys subprocess agents only, leaving the mounted persona untouched", async () => {
    await supervisor.spawnGuest(makeSpec("worker-1"));
    await supervisor.spawnGuest(makeSpec("worker-2"));
    const persona = await supervisor.mountInSession(
      makeSpec("orchestrator", { role: "orchestrator" }),
    );
    const destroySpy = vi.spyOn(supervisor, "destroyAgent");
    const personaDestroySpy = vi.spyOn(persona, "destroy");

    await cmd.handler("", ctx);

    expect(destroySpy).toHaveBeenCalledTimes(2);
    expect(destroySpy).toHaveBeenCalledWith("worker-1");
    expect(destroySpy).toHaveBeenCalledWith("worker-2");
    expect(destroySpy).not.toHaveBeenCalledWith("orchestrator");
    expect(personaDestroySpy).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 2 agent(s) destroyed.", "info");
  });

  it("notifies 0 when no agents", async () => {
    await cmd.handler("", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 0 agent(s) destroyed.", "info");
  });

  it("tolerates per-agent destroy failures and reports the fulfilled count", async () => {
    await supervisor.spawnGuest(makeSpec("ok"));
    await supervisor.spawnGuest(makeSpec("crashed"));
    const destroySpy = vi
      .spyOn(supervisor, "destroyAgent")
      .mockRejectedValueOnce(new Error("RPC destroy failed"));

    await cmd.handler("", ctx);

    expect(destroySpy).toHaveBeenCalledTimes(2);
    expect(ctx.ui.notify).toHaveBeenCalledWith("1 of 2 agent(s) destroyed, 1 failed.", "warning");
  });
});

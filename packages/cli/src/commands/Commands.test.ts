import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  makeSpec,
  toolListToRestrictions,
} from "../test-utils";
import { AgentDestroyAllCommand } from "./AgentDestroyAllCommand";
import { AgentDestroyCommand } from "./AgentDestroyCommand";
import { AgentListCommand } from "./AgentListCommand";
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
    cmd = new ResearchCommand(supervisor, pi, specManager);
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
    cmd = new AgentListCommand(supervisor, pi, makeMockSpecManager());
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
    cmd = new AgentDestroyCommand(supervisor, pi, makeMockSpecManager());
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
    cmd = new AgentDestroyAllCommand(supervisor, pi, makeMockSpecManager());
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

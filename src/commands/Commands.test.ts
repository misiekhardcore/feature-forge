import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ResearchCommand } from "./ResearchCommand";
import { AgentListCommand } from "./AgentListCommand";
import { AgentDestroyCommand } from "./AgentDestroyCommand";
import { AgentDestroyAllCommand } from "./AgentDestroyAllCommand";
import type { CommandDeps } from "../registry/CommandDeps";
import { InMemoryAgentSupervisor } from "../agents/supervisors";
import { makeMockFactory, makeSpec, makeMockCtx, makeMockPi } from "../test-utils";

describe("ResearchCommand", () => {
  let deps: CommandDeps;
  let cmd: ResearchCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    const pi = makeMockPi();
    deps = { supervisor, pi } as CommandDeps;
    cmd = new ResearchCommand(deps);
    ctx = makeMockCtx();
  });

  it("has name 'research'", () => {
    expect(cmd.name).toBe("research");
  });

  it("notifies error when args is empty", async () => {
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /research <topic>", "error");
  });

  it("notifies error when args is whitespace", async () => {
    await cmd.execute("   ", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /research <topic>", "error");
  });

  it("triggers supervisor.runAgent with trimmed topic", async () => {
    vi.spyOn(deps.supervisor, "runAgent").mockResolvedValue(undefined);
    await cmd.execute("  quantum computing  ", ctx as unknown as ExtensionCommandContext);
    expect(deps.supervisor.runAgent).toHaveBeenCalledWith(
      expect.any(Object),
      "quantum computing",
      deps.pi,
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'Research agent investigating "quantum computing" in the background...',
      "info",
    );
  });
});

describe("AgentListCommand", () => {
  let deps: CommandDeps;
  let cmd: AgentListCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    deps = { supervisor, pi: makeMockPi() } as CommandDeps;
    cmd = new AgentListCommand(deps);
    ctx = makeMockCtx();
  });

  it("has name 'agent:list'", () => {
    expect(cmd.name).toBe("agent:list");
  });

  it("notifies when no agents tracked", async () => {
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No agents currently tracked.", "info");
  });

  it("lists tracked agents with their status", async () => {
    await deps.supervisor.spawn(makeSpec("a1", { role: "worker" }));
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Tracked agents (1)"),
      "info",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("a1"), "info");
  });
});

describe("AgentDestroyCommand", () => {
  let deps: CommandDeps;
  let cmd: AgentDestroyCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    deps = { supervisor, pi: makeMockPi() } as CommandDeps;
    cmd = new AgentDestroyCommand(deps);
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy'", () => {
    expect(cmd.name).toBe("agent:destroy");
  });

  it("notifies error when args is empty", async () => {
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /agent:destroy <name>", "error");
  });

  it("calls supervisor.destroyAgent and notifies", async () => {
    vi.spyOn(deps.supervisor, "destroyAgent").mockResolvedValue(undefined);
    await cmd.execute("agent-1", ctx as unknown as ExtensionCommandContext);
    expect(deps.supervisor.destroyAgent).toHaveBeenCalledWith("agent-1");
    expect(ctx.ui.notify).toHaveBeenCalledWith('Agent "agent-1" destroyed.', "info");
  });
});

describe("AgentDestroyAllCommand", () => {
  let deps: CommandDeps;
  let cmd: AgentDestroyAllCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    deps = { supervisor, pi: makeMockPi() } as CommandDeps;
    cmd = new AgentDestroyAllCommand(deps);
    ctx = makeMockCtx();
  });

  it("has name 'agent:destroy-all'", () => {
    expect(cmd.name).toBe("agent:destroy-all");
  });

  it("calls supervisor.destroyAll and notifies with count", async () => {
    await deps.supervisor.spawn(makeSpec("a1"));
    await deps.supervisor.spawn(makeSpec("a2"));
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 2 agent(s) destroyed.", "info");
  });

  it("notifies 0 when no agents", async () => {
    await cmd.execute("", ctx as unknown as ExtensionCommandContext);
    expect(ctx.ui.notify).toHaveBeenCalledWith("All 0 agent(s) destroyed.", "info");
  });
});

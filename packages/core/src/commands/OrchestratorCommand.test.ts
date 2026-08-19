import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionAgent } from "@feature-forge/core/src/agents/SessionAgent";
import type { AgentSpecification } from "@feature-forge/core/src/agents/specifications";
import type { SpecManager } from "@feature-forge/core/src/agents/SpecManager";
import type { AgentSupervisor } from "@feature-forge/core/src/agents/supervisors/AgentSupervisor";
import { InMemoryAgentSupervisor } from "@feature-forge/core/src/agents/supervisors/InMemoryAgentSupervisor";
import { Command } from "@feature-forge/core/src/commands/Command";
import { ActiveFlowRegistry } from "@feature-forge/core/src/flows/ActiveFlowRegistry";
import type { FlowDefinition } from "@feature-forge/core/src/flows/FlowInstruction";
import { FLOW_SCHEMA_URL } from "@feature-forge/core/src/flows/FlowInstruction";
import { FlowStateStore } from "@feature-forge/core/src/flows/FlowStateStore";
import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockToolRegistry,
} from "@feature-forge/core/src/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrchestratorCommand } from "./OrchestratorCommand";

/**
 * Minimal local stand-in for the cli `flow:exit` command (D3: the real
 * command lives in the cli package). Only the behavior this test observes
 * is reproduced: destroy every mounted session agent via the supervisor
 * (which unmounts the agent and restores the saved tools) and clear the
 * active-flow pointer.
 */
class TestFlowExitCommand extends Command {
  readonly name = "flow:exit";
  readonly description = "exit the current flow and restore default mode";

  async handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const mountedAgents = this.supervisor!.getAllAgents().filter(
      (agent): agent is SessionAgent => agent instanceof SessionAgent && agent.isMounted,
    );
    for (const agent of mountedAgents) {
      await this.supervisor!.destroyAgent(agent.id);
    }
    ctx.ui.notify(
      mountedAgents.length === 0
        ? "Flow exited. No active flow to exit."
        : "Flow exited. Default system prompt and tools restored.",
      "info",
    );
    this.activeFlow?.clear();
  }
}

// ── Mocks ────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  // Plain object spec (no module imports are safe inside vi.hoisted).
  const spec = {
    id: "implement",
    role: "orchestrator",
    systemPrompt: "# persona",
    toolRestrictions: {},
    excludedTools: [],
    disableBuiltinTools: false,
    disableContextFiles: false,
    disableExtensions: false,
    disablePromptTemplates: false,
    disableSkills: false,
    ephemeral: false,
    skills: [],
    excludedSkills: [],
    get tools() {
      return [];
    },
  } as unknown as AgentSpecification;
  const agentMock = {
    mount: vi.fn(),
    // A mounted agent must report itself as mounted so the command does not
    // recreate it on every handler call (see the mount→exit→re-mount test).
    isMounted: true,
  };
  const forgeConfigMock = {
    getConfig: vi.fn(),
  };
  return {
    spec,
    agentMock,
    forgeConfigMock,
    reset() {
      agentMock.mount = vi.fn();
      forgeConfigMock.getConfig = vi.fn();
    },
  };
});

vi.mock("@feature-forge/core", async () => {
  const actual = await vi.importActual<typeof import("@feature-forge/core")>("@feature-forge/core");
  return {
    ...actual,
    ForgeConfig: {
      getInstance: vi.fn(() => hoisted.forgeConfigMock),
    },
  };
});

let pi: ExtensionAPI;
let specManager: SpecManager;

beforeEach(() => {
  pi = makeMockPi();
  vi.clearAllMocks();
  hoisted.reset();
  (pi as unknown as Record<string, unknown>).setModel = vi.fn().mockResolvedValue(true);
  (pi as unknown as Record<string, unknown>).setThinkingLevel = vi.fn();
  specManager = {
    resolve: vi.fn().mockReturnValue(hoisted.spec),
  } as unknown as SpecManager;
});

function makeCmd(
  supervisor: AgentSupervisor,
  flow: FlowDefinition,
  deps: { store?: FlowStateStore; activeFlow?: ActiveFlowRegistry } = {},
): OrchestratorCommand {
  return new OrchestratorCommand({
    supervisor,
    pi,
    specManager,
    toolRegistry: makeMockToolRegistry(),
    flow,
    store: deps.store ?? new FlowStateStore(),
    activeFlow: deps.activeFlow ?? new ActiveFlowRegistry(),
  });
}

describe("OrchestratorCommand", () => {
  const baseFlow: FlowDefinition = {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "implement" },
    routines: [],
  };

  function makeSupervisor() {
    return {
      mountInSession: vi.fn().mockResolvedValue(hoisted.agentMock),
      // The cached agent stays registered in the supervisor map while alive.
      getAgent: vi.fn().mockReturnValue(hoisted.agentMock),
    } as unknown as AgentSupervisor;
  }

  it("has name derived from flow.command without leading slash", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.name).toBe("test");
  });

  it("has derived description", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.description).toBe("Run the test-flow orchestrator workflow");
  });

  it("resolves the spec by name, mounts an in-session agent, and drives the live session", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "implement", prompt: "Do the {{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("fix bug", ctx);

    expect(specManager.resolve).toHaveBeenCalledWith({ spec: "implement" });
    expect(supervisor.mountInSession).toHaveBeenCalledWith(hoisted.spec);
    // prompt template resolved against args
    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "Do the fix bug");
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("uses fallback text when args is empty", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "implement", prompt: "Do the {{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("", ctx);

    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "Do the (no task provided)");
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("resolves promptParams placeholders", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: {
        systemPrompt: "implement",
        prompt: "{{prompt}} [{{CONTEXT}}]",
        promptParams: { CONTEXT: "extra" },
      },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("task", ctx);

    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "task [extra]");
  });

  it("caches the spec and in-session agent across handler calls", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "implement", prompt: "{{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("first", ctx);
    await cmd.handler("second", ctx);

    expect(specManager.resolve).toHaveBeenCalledTimes(1);
    expect(supervisor.mountInSession).toHaveBeenCalledTimes(1);
    expect(hoisted.agentMock.mount).toHaveBeenCalledTimes(2);
    expect(hoisted.agentMock.mount).toHaveBeenNthCalledWith(1, pi, "first");
    expect(hoisted.agentMock.mount).toHaveBeenNthCalledWith(2, pi, "second");
  });

  it("registers the flow as active after a successful mount", async () => {
    const supervisor = makeSupervisor();
    const store = new FlowStateStore();
    const activeFlow = new ActiveFlowRegistry();
    const cmd = makeCmd(supervisor, baseFlow, { store, activeFlow });

    const ctx = makeMockCtx();
    await cmd.handler("task", ctx);

    expect(activeFlow.getStore()).toBe(store);
    expect(activeFlow.currentFlowName).toBe("test-flow");
  });

  it("does not register an active flow when mount throws", async () => {
    hoisted.agentMock.mount = vi.fn().mockImplementation(() => {
      throw new Error("mount boom");
    });
    const supervisor = makeSupervisor();
    const activeFlow = new ActiveFlowRegistry();
    const cmd = makeCmd(supervisor, baseFlow, { activeFlow });

    const ctx = makeMockCtx();
    await expect(cmd.handler("task", ctx)).rejects.toThrow("mount boom");

    // A failed mount must not leave a stale pointer for set_flow_param.
    expect(activeFlow.getStore()).toBeUndefined();
  });

  // ── Error-path UX ──────────────────────────────────────────────

  it("notifies and skips mounting when the orchestrator spec cannot be resolved", async () => {
    specManager.resolve = vi.fn().mockImplementation(() => {
      throw new Error("Spec 'implement' not found");
    });
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);

    const ctx = makeMockCtx();
    await expect(cmd.handler("task", ctx)).resolves.toBeUndefined();

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Cannot start /test"),
      "error",
    );
    expect(supervisor.mountInSession).not.toHaveBeenCalled();
    expect(hoisted.agentMock.mount).not.toHaveBeenCalled();
  });

  it("notifies and skips mounting when a declared tool is not registered", async () => {
    const specWithTools = {
      ...hoisted.spec,
      get tools() {
        return ["inspect", "missing_tool"];
      },
    } as unknown as AgentSpecification;
    specManager.resolve = vi.fn().mockReturnValue(specWithTools);
    (pi as unknown as Record<string, unknown>).getAllTools = vi
      .fn()
      .mockReturnValue([{ name: "inspect" }]);

    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);

    const ctx = makeMockCtx();
    await expect(cmd.handler("task", ctx)).resolves.toBeUndefined();

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("missing_tool"), "error");
    expect(supervisor.mountInSession).not.toHaveBeenCalled();
    expect(hoisted.agentMock.mount).not.toHaveBeenCalled();
  });

  it("does not register an active flow when the spec cannot be resolved", async () => {
    specManager.resolve = vi.fn().mockImplementation(() => {
      throw new Error("Spec 'implement' not found");
    });
    const supervisor = makeSupervisor();
    const activeFlow = new ActiveFlowRegistry();
    const cmd = makeCmd(supervisor, baseFlow, { activeFlow });

    const ctx = makeMockCtx();
    await expect(cmd.handler("task", ctx)).resolves.toBeUndefined();

    expect(activeFlow.getStore()).toBeUndefined();
  });

  it("does not register an active flow when a tool is missing", async () => {
    const specWithTools = {
      ...hoisted.spec,
      get tools() {
        return ["inspect", "missing_tool"];
      },
    } as unknown as AgentSpecification;
    specManager.resolve = vi.fn().mockReturnValue(specWithTools);
    (pi as unknown as Record<string, unknown>).getAllTools = vi
      .fn()
      .mockReturnValue([{ name: "inspect" }]);

    const supervisor = makeSupervisor();
    const activeFlow = new ActiveFlowRegistry();
    const cmd = makeCmd(supervisor, baseFlow, { activeFlow });

    const ctx = makeMockCtx();
    await expect(cmd.handler("task", ctx)).resolves.toBeUndefined();

    expect(activeFlow.getStore()).toBeUndefined();
  });

  // ── Model / thinkingLevel resolution ──────────────────────────

  const mockModel = {
    id: "claude-sonnet-4-5",
    provider: "anthropic",
    name: "Claude Sonnet 4.5",
  };

  it("applies resolved model and thinkingLevel from spec", async () => {
    const specWithModel: AgentSpecification = {
      ...hoisted.spec,
      model: "smart",
      thinkingLevel: "high",
    } as AgentSpecification;
    specManager.resolve = vi.fn().mockReturnValue(specWithModel);

    hoisted.forgeConfigMock.getConfig.mockReturnValue({
      models: {
        smart: { model: "claude-sonnet-4-5", provider: "anthropic", thinkingLevel: "xhigh" },
      },
    });

    const ctx = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).modelRegistry = {
      getAvailable: vi.fn().mockReturnValue([mockModel]),
    };

    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);
    await cmd.handler("task", ctx);

    // spec thinkingLevel wins over preset
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("high");
    expect(pi.setModel).toHaveBeenCalledWith(mockModel);
  });

  it("applies thinkingLevel from preset when spec has no thinkingLevel", async () => {
    const specWithModel: AgentSpecification = {
      ...hoisted.spec,
      model: "smart",
    } as AgentSpecification;
    specManager.resolve = vi.fn().mockReturnValue(specWithModel);

    hoisted.forgeConfigMock.getConfig.mockReturnValue({
      models: {
        smart: { model: "claude-sonnet-4-5", provider: "anthropic", thinkingLevel: "xhigh" },
      },
    });

    const ctx = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).modelRegistry = {
      getAvailable: vi.fn().mockReturnValue([mockModel]),
    };

    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);
    await cmd.handler("task", ctx);

    // thinkingLevel comes from preset since spec has none
    expect(pi.setThinkingLevel).toHaveBeenCalledWith("xhigh");
    expect(pi.setModel).toHaveBeenCalledWith(mockModel);
  });

  it("does not call setModel when spec has no model field", async () => {
    // hoisted.spec has no model or thinkingLevel — resolution block is skipped
    const ctx = makeMockCtx();
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);
    await cmd.handler("task", ctx);

    expect(pi.setModel).not.toHaveBeenCalled();
    expect(pi.setThinkingLevel).not.toHaveBeenCalled();
  });

  it("does not call setModel when model not found in registry", async () => {
    const specWithModel: AgentSpecification = {
      ...hoisted.spec,
      model: "unknown-model",
    } as AgentSpecification;
    specManager.resolve = vi.fn().mockReturnValue(specWithModel);

    // resolveModel returns passthrough { model: "unknown-model" } — no thinkingLevel
    hoisted.forgeConfigMock.getConfig.mockReturnValue({
      models: {},
    });

    const ctx = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).modelRegistry = {
      getAvailable: vi.fn().mockReturnValue([]),
    };

    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, baseFlow);
    await cmd.handler("task", ctx);

    expect(pi.setModel).not.toHaveBeenCalled();
    expect(pi.setThinkingLevel).not.toHaveBeenCalled();
  });

  // ── Mount → flow:exit → re-mount → flow:exit regression (3.18) ───────────

  /**
   * Tracked pi that records before_agent_start handlers and keeps a real
   * active-tools array so persona injection and tool restoration are
   * observable across mount/unmount cycles.
   */
  function makeTrackedPi(defaultTools: string[]) {
    const handlers: Array<(event: { systemPrompt: string }) => unknown> = [];
    const activeTools = [...defaultTools];
    const base = makeMockPi();
    return {
      ...base,
      on: vi.fn((event: string, handler: (event: { systemPrompt: string }) => unknown) => {
        if (event === "before_agent_start") handlers.push(handler);
      }),
      getActiveTools: vi.fn(() => [...activeTools]),
      setActiveTools: vi.fn((tools: string[]) => {
        activeTools.length = 0;
        activeTools.push(...tools);
      }),
      getHandlers: () => handlers,
    } as unknown as ExtensionAPI & {
      getHandlers: () => Array<(event: { systemPrompt: string }) => unknown>;
    };
  }

  it("recreates the agent after flow:exit so re-mount restores persona and tools", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "implement", prompt: "{{prompt}}" },
    };
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    const trackedPi = makeTrackedPi(["read", "bash"]);
    const ctx = makeMockCtx();
    const cmd = new OrchestratorCommand({
      supervisor,
      pi: trackedPi,
      specManager,
      toolRegistry: makeMockToolRegistry(),
      flow,
      store: new FlowStateStore(),
      activeFlow: new ActiveFlowRegistry(),
    });
    const exitCmd = new TestFlowExitCommand({ supervisor, pi: trackedPi });
    const personaEvent = { systemPrompt: "base prompt" };

    // Mount #1: one fresh handler injects the persona; tools untouched yet.
    await cmd.handler("first", ctx);
    const firstAgent = supervisor.getAllAgents()[0] as SessionAgent;
    expect(firstAgent.isMounted).toBe(true);
    const handlersAfterMount1 = trackedPi.getHandlers();
    expect(handlersAfterMount1).toHaveLength(1);
    expect(
      (handlersAfterMount1[0](personaEvent) as { systemPrompt?: string }).systemPrompt,
    ).toContain("# persona");

    // Exit #1: agent destroyed + de-registered; persona suppressed; tools restored.
    await exitCmd.handler("", ctx);
    expect(supervisor.getAllAgents()).toHaveLength(0);
    expect(firstAgent.isMounted).toBe(false);
    expect(handlersAfterMount1[0](personaEvent)).toEqual({});
    expect(trackedPi.setActiveTools).toHaveBeenCalledWith(["read", "bash"]);
    expect(trackedPi.getActiveTools()).toEqual(["read", "bash"]);

    // Mount #2: the DESTROYED agent must not be re-mounted — a fresh agent
    // is created, registering exactly one new handler (no stacking).
    await cmd.handler("second", ctx);
    const secondAgent = supervisor.getAllAgents()[0] as SessionAgent;
    expect(secondAgent).not.toBe(firstAgent);
    expect(secondAgent.isMounted).toBe(true);
    const handlersAfterMount2 = trackedPi.getHandlers();
    expect(handlersAfterMount2).toHaveLength(2);
    // Old handler stays inert; the new handler injects the persona again.
    expect(handlersAfterMount2[0](personaEvent)).toEqual({});
    expect(
      (handlersAfterMount2[1](personaEvent) as { systemPrompt?: string }).systemPrompt,
    ).toContain("# persona");

    // Exit #2: torn down again — persona suppressed and tools restored.
    await exitCmd.handler("", ctx);
    expect(supervisor.getAllAgents()).toHaveLength(0);
    expect(secondAgent.isMounted).toBe(false);
    expect(handlersAfterMount2[1](personaEvent)).toEqual({});
    expect(trackedPi.setActiveTools).toHaveBeenLastCalledWith(["read", "bash"]);
    expect(trackedPi.getActiveTools()).toEqual(["read", "bash"]);
  });

  it("recreates the agent when the cached agent is missing from the supervisor", async () => {
    const supervisor = makeSupervisor();
    // Simulate a destroyed agent: still mounted per its own state, but no
    // longer registered with the supervisor (TestFlowExitCommand removes it).
    (supervisor.getAgent as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const cmd = makeCmd(supervisor, baseFlow);

    const ctx = makeMockCtx();
    await cmd.handler("first", ctx);
    expect(supervisor.mountInSession).toHaveBeenCalledTimes(1);

    await cmd.handler("second", ctx);
    expect(supervisor.mountInSession).toHaveBeenCalledTimes(2);
    expect(hoisted.agentMock.mount).toHaveBeenCalledTimes(2);
  });
});

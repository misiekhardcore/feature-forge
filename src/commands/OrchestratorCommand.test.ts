import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSpecification } from "../agents/specifications";
import type { SpecManager } from "../agents/SpecManager";
import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import { makeMockCtx, makeMockPi } from "../test-utils";
import type { WorkspaceManager } from "../workspace";
import { OrchestratorCommand } from "./OrchestratorCommand";

// ── Mocks ────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  // Plain object spec (no module imports are safe inside vi.hoisted).
  const spec = {
    id: "orchestrator",
    role: "orchestrator",
    systemPrompt: "# persona",
    tools: [],
  } as unknown as AgentSpecification;
  const agentMock = {
    mount: vi.fn(),
  };
  return {
    spec,
    agentMock,
    reset() {
      agentMock.mount = vi.fn();
    },
  };
});

vi.mock("../agents/factories/FlowSpecLoader", () => ({
  FlowSpecLoader: {
    load: vi.fn().mockResolvedValue(hoisted.spec),
  },
}));

import { FlowSpecLoader } from "../agents/factories/FlowSpecLoader";

let pi: ExtensionAPI;

beforeEach(() => {
  pi = makeMockPi();
  vi.clearAllMocks();
  hoisted.reset();
  (FlowSpecLoader.load as ReturnType<typeof vi.fn>).mockResolvedValue(hoisted.spec);
});

function makeCmd(
  supervisor: { mountInSession: ReturnType<typeof vi.fn> },
  flow: FlowDefinition,
  flowDir = "/fake/flow/dir",
): OrchestratorCommand {
  return new OrchestratorCommand(
    supervisor as unknown as AgentSupervisor,
    pi,
    {} as unknown as SpecManager,
    undefined as unknown as WorkspaceManager | undefined,
    flow,
    flowDir,
  );
}

describe("OrchestratorCommand", () => {
  const baseFlow: FlowDefinition = {
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "orchestrator.md" },
    routines: {},
  };

  function makeSupervisor() {
    return { mountInSession: vi.fn().mockResolvedValue(hoisted.agentMock) };
  }

  it("has name derived from flow.command without leading slash", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.name).toBe("test");
  });

  it("has derived description", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.description).toContain("test-flow");
  });

  it("loads the spec, mounts an in-session agent, and drives the live session", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "orchestrator.md", prompt: "Do the {{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("fix bug", ctx as unknown as ExtensionCommandContext);

    expect(FlowSpecLoader.load).toHaveBeenCalledWith(flow, "/fake/flow/dir");
    expect(supervisor.mountInSession).toHaveBeenCalledWith(hoisted.spec);
    // prompt template resolved against args
    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "Do the fix bug");
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("uses fallback text when args is empty", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "orchestrator.md", prompt: "Do the {{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("", ctx as unknown as ExtensionCommandContext);

    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "Do the (no task provided)");
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("resolves promptParams placeholders", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: {
        systemPrompt: "orchestrator.md",
        prompt: "{{prompt}} [{{CONTEXT}}]",
        promptParams: { CONTEXT: "extra" },
      },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("task", ctx as unknown as ExtensionCommandContext);

    expect(hoisted.agentMock.mount).toHaveBeenCalledWith(pi, "task [extra]");
  });

  it("caches the spec and in-session agent across handler calls", async () => {
    const flow: FlowDefinition = {
      ...baseFlow,
      orchestrator: { systemPrompt: "orchestrator.md", prompt: "{{prompt}}" },
    };
    const supervisor = makeSupervisor();
    const cmd = makeCmd(supervisor, flow);

    const ctx = makeMockCtx();
    await cmd.handler("first", ctx as unknown as ExtensionCommandContext);
    await cmd.handler("second", ctx as unknown as ExtensionCommandContext);

    expect(FlowSpecLoader.load).toHaveBeenCalledTimes(1);
    expect(supervisor.mountInSession).toHaveBeenCalledTimes(1);
    expect(hoisted.agentMock.mount).toHaveBeenCalledTimes(2);
    expect(hoisted.agentMock.mount).toHaveBeenNthCalledWith(1, pi, "first");
    expect(hoisted.agentMock.mount).toHaveBeenNthCalledWith(2, pi, "second");
  });
});

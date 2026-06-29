import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import { makeMockCtx, makeMockPi } from "../test-utils";
import type { WorkspaceManager } from "../workspace";
import { OrchestratorCommand } from "./OrchestratorCommand";

// ── Mock OrchestratorAgent ───────────────────────────────────

const hoisted = vi.hoisted(() => {
  const agentMock = {
    mount: vi.fn(),
  };
  return {
    agentMock,
    resetAgentMock() {
      agentMock.mount = vi.fn();
    },
  };
});

vi.mock("../agents/orchestrator/OrchestratorAgent", () => ({
  OrchestratorAgent: {
    create: vi.fn().mockResolvedValue(hoisted.agentMock),
  },
}));

import { OrchestratorAgent } from "../agents/orchestrator/OrchestratorAgent";

let pi: ExtensionAPI;

beforeEach(() => {
  pi = makeMockPi();
  vi.clearAllMocks();
  hoisted.resetAgentMock();
  (OrchestratorAgent.create as ReturnType<typeof vi.fn>).mockResolvedValue(hoisted.agentMock);
});

function makeCmd(flow: FlowDefinition, flowDir = "/fake/flow/dir"): OrchestratorCommand {
  return new OrchestratorCommand(
    {} as unknown as AgentSupervisor,
    pi,
    {} as unknown as SpecManager,
    undefined as unknown as WorkspaceManager | undefined,
    flow,
    flowDir,
  );
}

describe("OrchestratorCommand", () => {
  const flow: FlowDefinition = {
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "orchestrator.md" },
    routines: {},
  };

  it("has name derived from flow.command without leading slash", () => {
    const cmd = makeCmd(flow);
    expect(cmd.name).toBe("test");
  });

  it("has derived description", () => {
    const cmd = makeCmd(flow);
    expect(cmd.description).toContain("test-flow");
  });

  it("creates OrchestratorAgent on first handler call and mounts it", async () => {
    const flowWithTask: FlowDefinition = {
      ...flow,
      orchestrator: {
        systemPrompt: "orchestrator.md",
        prompt: "Do the {{prompt}}",
      },
    };
    const cmd = makeCmd(flowWithTask);

    const ctx = makeMockCtx();

    await cmd.handler("fix bug", ctx as unknown as ExtensionCommandContext);

    expect(OrchestratorAgent.create).toHaveBeenCalledWith(flowWithTask, "/fake/flow/dir");
    expect(hoisted.agentMock.mount).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("uses fallback text when args is empty", async () => {
    const cmd = makeCmd({
      ...flow,
      orchestrator: {
        systemPrompt: "orchestrator.md",
        prompt: "Do the {{prompt}}",
      },
    });

    const ctx = makeMockCtx();

    await cmd.handler("", ctx as unknown as ExtensionCommandContext);

    expect(hoisted.agentMock.mount).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("reuses cached agent on second handler call", async () => {
    const cmd = makeCmd({
      ...flow,
      orchestrator: {
        systemPrompt: "orchestrator.md",
        prompt: "Do the {{prompt}}",
      },
    });

    const ctx = makeMockCtx();

    await cmd.handler("first", ctx as unknown as ExtensionCommandContext);
    await cmd.handler("second", ctx as unknown as ExtensionCommandContext);

    // create should only be called once, mount twice
    expect(OrchestratorAgent.create).toHaveBeenCalledTimes(1);
    expect(hoisted.agentMock.mount).toHaveBeenCalledTimes(2);
  });
});

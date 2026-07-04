import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSpecification } from "../agents/specifications";
import type { SpecManager } from "../agents/SpecManager";
import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import { FLOW_SCHEMA_URL } from "../orchestrator/FlowInstruction";
import { makeMockCtx, makeMockPi } from "../test-utils";
import { OrchestratorCommand } from "./OrchestratorCommand";

// ── Mocks ────────────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  // Plain object spec (no module imports are safe inside vi.hoisted).
  const spec = {
    id: "implement",
    role: "orchestrator",
    systemPrompt: "# persona",
    tools: [],
    excludedTools: [],
    disableBuiltinTools: false,
    disableContextFiles: false,
    disableExtensions: false,
    disablePromptTemplates: false,
    disableSkills: false,
    ephemeral: false,
  } as AgentSpecification;
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

let pi: ExtensionAPI;
let specManager: SpecManager;

beforeEach(() => {
  pi = makeMockPi();
  vi.clearAllMocks();
  hoisted.reset();
  specManager = {
    resolve: vi.fn().mockReturnValue(hoisted.spec),
  } as unknown as SpecManager;
});

function makeCmd(supervisor: AgentSupervisor, flow: FlowDefinition): OrchestratorCommand {
  return new OrchestratorCommand(supervisor, pi, specManager, undefined, flow);
}

describe("OrchestratorCommand", () => {
  const baseFlow: FlowDefinition = {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "implement" },
    routines: {},
  };

  function makeSupervisor() {
    return {
      mountInSession: vi.fn().mockResolvedValue(hoisted.agentMock),
    } as unknown as AgentSupervisor;
  }

  it("has name derived from flow.command without leading slash", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.name).toBe("test");
  });

  it("has derived description", () => {
    const cmd = makeCmd(makeSupervisor(), baseFlow);
    expect(cmd.description).toContain("test-flow");
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
});

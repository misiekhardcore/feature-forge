import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import { makeMockCtx, makeMockPi } from "../test-utils";
import type { WorkspaceManager } from "../workspace";
import { OrchestratorCommand } from "./OrchestratorCommand";

let pi: ExtensionAPI;

beforeEach(() => {
  pi = makeMockPi();
});

function makeCmd(flow: FlowDefinition, prompt = "prompt"): OrchestratorCommand {
  return new OrchestratorCommand(
    {} as unknown as AgentSupervisor,
    pi,
    {} as unknown as SpecManager,
    undefined as unknown as WorkspaceManager | undefined,
    flow,
    prompt,
  );
}

describe("OrchestratorCommand", () => {
  const flow: FlowDefinition = {
    name: "test-flow",
    command: "/test",
    orchestrator: { prompt: "You are the {{task}} orchestrator." },
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

  it("sends resolved prompt and notifies on success", async () => {
    const cmd = makeCmd(flow, "Do the {{task}}");
    const ctx = makeMockCtx();

    await cmd.handler("fix bug", ctx as unknown as ExtensionCommandContext);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("Do the fix bug");
    expect(ctx.ui.notify).toHaveBeenCalledWith("test-flow orchestrator loaded.", "info");
  });

  it("uses fallback text when args is empty", async () => {
    const cmd = makeCmd(flow, "Do the {{task}}");
    const ctx = makeMockCtx();

    await cmd.handler("", ctx as unknown as ExtensionCommandContext);

    expect(pi.sendUserMessage).toHaveBeenCalledWith("Do the (no task provided)");
  });

  it("sets active tools when declared in flow config", async () => {
    const flowWithTools: FlowDefinition = {
      ...flow,
      orchestrator: {
        prompt: "t",
        activeTools: ["run_build_loop", "bash"],
      },
    };

    const cmd = makeCmd(flowWithTools);
    const ctx = makeMockCtx();

    await cmd.handler("task", ctx as unknown as ExtensionCommandContext);

    expect(pi.setActiveTools).toHaveBeenCalledWith(["run_build_loop", "bash"]);
  });

  it("does not set active tools when not declared", async () => {
    const cmd = makeCmd(flow);
    const ctx = makeMockCtx();

    await cmd.handler("task", ctx as unknown as ExtensionCommandContext);

    expect(pi.setActiveTools).not.toHaveBeenCalled();
  });
});

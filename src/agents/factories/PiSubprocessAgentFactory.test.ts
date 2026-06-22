import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.hoisted(() => {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      promptAndWait: vi.fn().mockResolvedValue([]),
    };
  }
  reset();

  function MockRpcClientConstructor() {
    return instance;
  }

  return {
    get instance() {
      return instance!;
    },
    reset,
    factory: () => ({
      RpcClient: MockRpcClientConstructor,
      ExtensionAPI: class {},
      ExtensionCommandContext: class {},
      ExtensionContext: class {},
    }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => rpcMock.factory());

import { PiSubprocessAgentFactory } from "./PiSubprocessAgentFactory";
import { PiSubprocessAgent } from "../agents/PiSubprocessAgent";
import { AgentCreationError } from "./AgentFactory";
import { makeSpec } from "../../test-utils";

describe("PiSubprocessAgentFactory", () => {
  let factory: PiSubprocessAgentFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.reset();
    factory = new PiSubprocessAgentFactory();
  });

  it("creates a PiSubprocessAgent with correct identifier", async () => {
    const agent = await factory.create(makeSpec("factory-test", { role: "factory-tester" }));
    expect(agent).toBeInstanceOf(PiSubprocessAgent);
    expect(agent.identifier.toString()).toBe("factory-test");
  });

  it("calls start on the agent during creation", async () => {
    await factory.create(makeSpec("factory-test"));
    expect(rpcMock.instance.start).toHaveBeenCalledTimes(1);
  });

  it("throws AgentCreationError when start fails", async () => {
    rpcMock.instance.start.mockRejectedValue(new Error("Process died"));
    const spec = makeSpec("fail-boi");
    await expect(factory.create(spec)).rejects.toThrow(AgentCreationError);
    await expect(factory.create(spec)).rejects.toThrow("Failed to start RPC process");
  });

  it("throws AgentCreationError when start fails with non-Error cause", async () => {
    rpcMock.instance.start.mockRejectedValue("string cause");
    const spec = makeSpec("fail-str");
    await expect(factory.create(spec)).rejects.toThrow(AgentCreationError);
    // The inner cause is stored but AgentCreationError message doesn't include it
    const err = await factory.create(spec).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentCreationError);
  });

  it("accepts custom RpcClientOptions", async () => {
    factory = new PiSubprocessAgentFactory({ cwd: "/tmp", cliPath: "/usr/bin/pi" });
    const agent = await factory.create(makeSpec("opts-test"));
    expect(agent).toBeInstanceOf(PiSubprocessAgent);
  });

  it("creates agents with CLI args for the spec", async () => {
    await factory.create(makeSpec("cli-args", { toolNames: ["read"], ephemeral: true }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("passes model preference to RpcClient", async () => {
    await factory.create(makeSpec("model-test", { modelPreference: "claude-sonnet-4-5" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });
});

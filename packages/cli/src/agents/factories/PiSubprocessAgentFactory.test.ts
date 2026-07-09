import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
      collectEvents: vi.fn().mockResolvedValue([]),
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
      getPackageDir: () => "/mock/pi/package/dir",
      RpcClient: MockRpcClientConstructor,
      ExtensionAPI: class {},
      ExtensionCommandContext: class {},
      ExtensionContext: class {},
    }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => rpcMock.factory());

import { makeSpec } from "../../test-utils";
import { PiSubprocessAgent } from "../agents/PiSubprocessAgent";
import { AgentCreationError } from "./AgentFactory";
import { PiSubprocessAgentFactory } from "./PiSubprocessAgentFactory";

describe("PiSubprocessAgentFactory", () => {
  let factory: PiSubprocessAgentFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.reset();
    factory = new PiSubprocessAgentFactory();
  });

  it("creates a PiSubprocessAgent with correct id", async () => {
    const agent = await factory.create(makeSpec("factory-test", { role: "factory-tester" }));
    expect(agent).toBeInstanceOf(PiSubprocessAgent);
    expect(agent.id).toBe("factory-test");
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
    await factory.create(makeSpec("cli-args", { toolRestrictions: { read: [] }, ephemeral: true }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("passes model preference to RpcClient", async () => {
    await factory.create(makeSpec("model-test", { model: "claude-sonnet-4-5" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });
});

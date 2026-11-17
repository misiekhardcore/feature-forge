import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => {
  let instance: Record<string, ReturnType<typeof vi.fn>>;
  let lastRpcOptions: Record<string, unknown> = {};

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      prompt: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    };
    lastRpcOptions = {};
  }
  reset();

  function MockRpcClientConstructor(opts: Record<string, unknown>) {
    lastRpcOptions = opts;
    return instance;
  }

  return {
    get instance() {
      return instance!;
    },
    get lastRpcOptions() {
      return lastRpcOptions;
    },
    reset,
    factory: () => ({
      getPackageDir: () => "/mock/pi/package/dir",
      RpcClient: MockRpcClientConstructor,
      ExtensionAPI: class {},
      ExtensionCommandContext: class {},
      ExtensionContext: class {},
      // SkillResolver reads skill frontmatter via this package export; a real
      // parser is not needed here since name resolution falls back to the
      // directory basename when frontmatter is absent.
      parseFrontmatter: () => ({ frontmatter: undefined, body: "" }),
    }),
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => rpcMock.factory());

vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return {
    ...actual,
    resolveModel: vi.fn((m: string | undefined, models: Record<string, unknown>) => {
      if (m === undefined) return undefined;
      if (m in models) {
        const preset = models[m] as Record<string, unknown>;
        return { ...preset, resolved: true };
      }
      return { model: m, resolved: false };
    }),
  };
});

vi.mock("../../logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../logging")>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { DEFAULT_FORGE_CONFIG } from "../../config/ForgeConfigDefaults";
import { makeSpec } from "../../test-utils";
import { PiSubprocessAgent } from "../PiSubprocessAgent";
import { AgentSpecification } from "../specifications/AgentSpecification";
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

  it("resolves model via models map when alias matches", async () => {
    factory = new PiSubprocessAgentFactory(
      {},
      { smart: { model: "claude-sonnet-4-5", provider: "anthropic" } },
    );
    await factory.create(makeSpec("resolved-test", { model: "smart" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("applies thinkingLevel from model preset to specification", async () => {
    factory = new PiSubprocessAgentFactory(
      {},
      { smart: { model: "claude-sonnet-4-5", provider: "anthropic", thinkingLevel: "high" } },
    );
    await factory.create(makeSpec("think-test", { model: "smart" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("does not override existing thinkingLevel with preset value", async () => {
    factory = new PiSubprocessAgentFactory(
      {},
      { smart: { model: "claude-sonnet-4-5", thinkingLevel: "high" } },
    );
    await factory.create(makeSpec("think-test", { model: "smart", thinkingLevel: "low" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("passes raw model string through when alias not in models map", async () => {
    factory = new PiSubprocessAgentFactory({}, { smart: { model: "claude-sonnet-4-5" } });
    await factory.create(makeSpec("passthrough-test", { model: "gpt-4o" }));
    expect(rpcMock.instance.start).toHaveBeenCalled();
  });

  it("does not pass model to RpcClient when preset name is not configured", async () => {
    await factory.create(makeSpec("dumb-test", { model: "dumb" }));
    expect(rpcMock.lastRpcOptions.model).toBeUndefined();
  });

  it("passes resolved model to RpcClient when preset is configured", async () => {
    factory = new PiSubprocessAgentFactory({}, { medium: { model: "claude-sonnet-4-5" } });
    await factory.create(makeSpec("medium-test", { model: "medium" }));
    expect(rpcMock.lastRpcOptions.model).toBe("claude-sonnet-4-5");
  });

  it("still passes through raw model when presets are configured", async () => {
    factory = new PiSubprocessAgentFactory({}, { medium: { model: "claude-sonnet-4-5" } });
    await factory.create(makeSpec("raw-test", { model: "gpt-4o" }));
    expect(rpcMock.lastRpcOptions.model).toBe("gpt-4o");
  });

  it("forwards agentDefaults.defaultTimeoutMs to created agents", async () => {
    factory = new PiSubprocessAgentFactory({}, {}, { defaultTimeoutMs: 500 });
    const agent = await factory.create(makeSpec("timeout-forward"));

    vi.useFakeTimers();
    try {
      const taskPromise = agent.executeTask("hang");
      const settled = taskPromise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(500);
      const rejection = await settled;
      expect((rejection as Error).message).toBe("Task timed out after 500ms");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the default forge timeout when agentDefaults are omitted", async () => {
    const agent = await factory.create(makeSpec("timeout-default"));

    vi.useFakeTimers();
    try {
      const taskPromise = agent.executeTask("hang");
      const settled = taskPromise.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(DEFAULT_FORGE_CONFIG.taskTimeoutMs);
      const rejection = await settled;
      expect((rejection as Error).message).toBe(
        `Task timed out after ${DEFAULT_FORGE_CONFIG.taskTimeoutMs}ms`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("threads agentDefaults.forgeHomes into the skill CLI arguments", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-factory-test-"));
    try {
      const skillName = path.basename(tempDir);
      const skillDir = path.join(tempDir, "skills", skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# test skill\n");

      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "skill-test",
            role: "skill-tester",
            systemPrompt: "You are a test.",
            skills: [skillName],
          });
        }
      })();

      factory = new PiSubprocessAgentFactory({}, {}, { forgeHomes: [tempDir] });
      await factory.create(spec);

      const args = rpcMock.lastRpcOptions.args as string[];
      expect(args).toContain("--no-skills");
      const skillIndex = args.indexOf("--skill");
      expect(skillIndex).toBeGreaterThan(-1);
      expect(args[skillIndex + 1]).toBe(path.join(skillDir, "SKILL.md"));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

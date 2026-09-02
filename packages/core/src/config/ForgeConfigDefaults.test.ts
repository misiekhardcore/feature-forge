import { describe, expect, it } from "vitest";

import defaultsJson from "./forge-config.defaults.json";
import { DEFAULT_AGENT_CONFIG, DEFAULT_FORGE_CONFIG, resolveConfig } from "./ForgeConfigDefaults";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

describe("DEFAULT_AGENT_CONFIG", () => {
  it("has no default model", () => {
    expect(DEFAULT_AGENT_CONFIG.model).toBeUndefined();
  });

  it("has maxToolCalls set to 40", () => {
    expect(DEFAULT_AGENT_CONFIG.maxToolCalls).toBe(40);
  });

  it("has maxTurns set to 100", () => {
    expect(DEFAULT_AGENT_CONFIG.maxTurns).toBe(100);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_AGENT_CONFIG)).toBe(true);
  });
});

describe("DEFAULT_FORGE_CONFIG", () => {
  it("has default log level Info", () => {
    expect(DEFAULT_FORGE_CONFIG.logLevel).toBe(LogLevel.INFO);
  });

  it("has no piCli override by default", () => {
    expect(DEFAULT_FORGE_CONFIG.piCli).toBeUndefined();
  });

  it("has default workspace provider GitWorktree", () => {
    expect(DEFAULT_FORGE_CONFIG.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
  });

  it("has an empty agents map", () => {
    expect(DEFAULT_FORGE_CONFIG.agents.size).toBe(0);
  });

  it("has default logDir .forge/logs/", () => {
    expect(DEFAULT_FORGE_CONFIG.logDir).toBe(".forge/logs/");
  });

  it("has default log retention of 7 days", () => {
    expect(DEFAULT_FORGE_CONFIG.logRetentionDays).toBe(7);
  });

  it("has default max log bytes of 10 MB", () => {
    expect(DEFAULT_FORGE_CONFIG.logMaxBytes).toBe(10 * 1024 * 1024);
  });

  it("has default max log files of 5", () => {
    expect(DEFAULT_FORGE_CONFIG.logMaxFiles).toBe(5);
  });

  it("has payload logging disabled by default", () => {
    expect(DEFAULT_FORGE_CONFIG.logPayloads).toBe(false);
  });

  it("has default empty worktreeSymlinks", () => {
    expect(DEFAULT_FORGE_CONFIG.worktreeSymlinks).toEqual([]);
  });

  it("has default taskTimeoutMs of 1 hour", () => {
    expect(DEFAULT_FORGE_CONFIG.taskTimeoutMs).toBe(3600000);
  });

  it("has default empty specDirectories", () => {
    expect(DEFAULT_FORGE_CONFIG.specDirectories).toEqual({ flows: [], agents: [] });
  });

  it("references DEFAULT_AGENT_CONFIG", () => {
    expect(DEFAULT_FORGE_CONFIG.defaultAgent).toBe(DEFAULT_AGENT_CONFIG);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG)).toBe(true);
  });

  it("is deep-frozen — nested structures cannot be mutated", () => {
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.worktreeSymlinks)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.specDirectories)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.specDirectories.flows)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.display)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.dev)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.models)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.agents)).toBe(true);
    expect(Object.isFrozen(DEFAULT_FORGE_CONFIG.defaultAgent)).toBe(true);
  });

  it("nested mutation attempts on the defaults throw", () => {
    // Cast through unknown: the readonly types prevent direct mutation
    // at compile time, but the regression is about runtime corruption.
    const mutable = DEFAULT_FORGE_CONFIG as unknown as {
      worktreeSymlinks: string[];
      display: { maxAgentEvents: number };
      dev: { enabled: boolean };
      specDirectories: { flows: string[] };
    };
    expect(() => {
      mutable.worktreeSymlinks.push("hack");
    }).toThrow(TypeError);
    expect(() => {
      mutable.display.maxAgentEvents = 1;
    }).toThrow(TypeError);
    expect(() => {
      mutable.dev.enabled = true;
    }).toThrow(TypeError);
    expect(() => {
      mutable.specDirectories.flows.push("hack");
    }).toThrow(TypeError);
  });

  it("blocks Map mutators on frozen defaults", () => {
    // Object.freeze does not block Map.set/delete/clear (internal slots) —
    // deepFreeze must install throwing stubs (regression for F1).
    const agents = DEFAULT_FORGE_CONFIG.agents as unknown as Map<string, { maxTurns: number }>;
    expect(() => agents.set("x", { maxTurns: 1 })).toThrow(TypeError);
    expect(() => agents.delete("x")).toThrow(TypeError);
    expect(() => agents.clear()).toThrow(TypeError);
  });

  it("mirrors the canonical forge-config.defaults.json", () => {
    expect(DEFAULT_FORGE_CONFIG.logLevel).toBe(defaultsJson.logLevel as LogLevel);
    expect(DEFAULT_FORGE_CONFIG.logPrefix).toBe(defaultsJson.logPrefix);
    expect(DEFAULT_FORGE_CONFIG.workspaceProvider).toBe(
      defaultsJson.workspaceProvider as WorkspaceProviderKind,
    );
    expect(DEFAULT_FORGE_CONFIG.logDir).toBe(defaultsJson.logDir);
    expect(DEFAULT_FORGE_CONFIG.logRetentionDays).toBe(defaultsJson.logRetentionDays);
    expect(DEFAULT_FORGE_CONFIG.logMaxBytes).toBe(defaultsJson.logMaxBytes);
    expect(DEFAULT_FORGE_CONFIG.logMaxFiles).toBe(defaultsJson.logMaxFiles);
    expect(DEFAULT_FORGE_CONFIG.logPayloads).toBe(defaultsJson.logPayloads);
    expect(DEFAULT_FORGE_CONFIG.worktreeSymlinks).toEqual(defaultsJson.worktreeSymlinks);
    expect(DEFAULT_FORGE_CONFIG.taskTimeoutMs).toBe(defaultsJson.taskTimeoutMs);
    expect(DEFAULT_FORGE_CONFIG.jsonRetryMaxAttempts).toBe(defaultsJson.jsonRetryMaxAttempts);
    expect(DEFAULT_FORGE_CONFIG.specDirectories).toEqual(defaultsJson.specDirectories);
    expect(DEFAULT_FORGE_CONFIG.display).toEqual(defaultsJson.display);
    expect(DEFAULT_FORGE_CONFIG.dev).toEqual(defaultsJson.dev);
    expect(DEFAULT_AGENT_CONFIG.maxToolCalls).toBe(defaultsJson.defaultAgent.maxToolCalls);
    expect(DEFAULT_AGENT_CONFIG.maxTurns).toBe(defaultsJson.defaultAgent.maxTurns);
  });
});

describe("resolveConfig", () => {
  it("returns defaults when called with empty overrides", () => {
    const config = resolveConfig({});
    expect(config.logLevel).toBe(LogLevel.INFO);
    expect(config.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
    expect(config.agents.size).toBe(0);
    expect(config.defaultAgent.model).toBeUndefined();
    expect(config.piCli).toBeUndefined();
  });

  it("overrides piCli", () => {
    const config = resolveConfig({ piCli: "/usr/local/bin/pi-cli.js" });
    expect(config.piCli).toBe("/usr/local/bin/pi-cli.js");
  });

  it("overrides logLevel", () => {
    const config = resolveConfig({ logLevel: LogLevel.DEBUG });
    expect(config.logLevel).toBe(LogLevel.DEBUG);
  });

  it("overrides workspaceProvider", () => {
    const config = resolveConfig({ workspaceProvider: WorkspaceProviderKind.CurrentDir });
    expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
  });

  it("overrides agents map", () => {
    const agentMap = new Map([["builder", { maxTurns: 50 }]]);
    const config = resolveConfig({ agents: agentMap });
    expect(config.agents.size).toBe(1);
    expect(config.agents.get("builder")?.maxTurns).toBe(50);
  });

  it("deep-clones agents map entries to prevent shared mutation", () => {
    const originalAgent = { maxTurns: 99 };
    const agentMap = new Map([["builder", originalAgent]]);
    const config = resolveConfig({ agents: agentMap });
    originalAgent.maxTurns = 42;
    expect(config.agents.get("builder")?.maxTurns).toBe(99);
  });

  it("overrides defaultAgent.maxTurns", () => {
    const config = resolveConfig({ defaultAgent: { maxTurns: 200 } });
    expect(config.defaultAgent.maxTurns).toBe(200);
  });

  it("overrides defaultAgent.maxToolCalls", () => {
    const config = resolveConfig({ defaultAgent: { maxToolCalls: 80 } });
    expect(config.defaultAgent.maxToolCalls).toBe(80);
  });

  it("overrides defaultAgent.model", () => {
    const config = resolveConfig({
      defaultAgent: { model: { model: "claude-sonnet-4-5" } },
    });
    expect(config.defaultAgent.model?.model).toBe("claude-sonnet-4-5");
  });

  it("deep-clones defaultAgent.model to prevent shared mutation", () => {
    const overrideModel = { model: "claude-sonnet-4-5" };
    const config = resolveConfig({ defaultAgent: { model: overrideModel } });
    overrideModel.model = "hacked";
    expect(config.defaultAgent.model?.model).toBe("claude-sonnet-4-5");
  });

  it("partially overrides defaultAgent leaving other fields at defaults", () => {
    const config = resolveConfig({ defaultAgent: { maxTurns: 50 } });
    expect(config.defaultAgent.maxTurns).toBe(50);
    expect(config.defaultAgent.maxToolCalls).toBe(DEFAULT_AGENT_CONFIG.maxToolCalls);
    // model should keep the default
    expect(config.defaultAgent.model?.model).toBe(DEFAULT_AGENT_CONFIG.model?.model);
  });

  it("overrides logDir", () => {
    const config = resolveConfig({ logDir: "/custom/logs" });
    expect(config.logDir).toBe("/custom/logs");
  });

  it("overrides logRetentionDays", () => {
    const config = resolveConfig({ logRetentionDays: 14 });
    expect(config.logRetentionDays).toBe(14);
  });

  it("overrides logMaxBytes", () => {
    const config = resolveConfig({ logMaxBytes: 123 });
    expect(config.logMaxBytes).toBe(123);
  });

  it("overrides logMaxFiles", () => {
    const config = resolveConfig({ logMaxFiles: 9 });
    expect(config.logMaxFiles).toBe(9);
  });

  it("overrides logPayloads", () => {
    const config = resolveConfig({ logPayloads: true });
    expect(config.logPayloads).toBe(true);
  });

  it("overrides worktreeSymlinks", () => {
    const config = resolveConfig({ worktreeSymlinks: ["config", "secrets"] });
    expect(config.worktreeSymlinks).toEqual(["config", "secrets"]);
  });

  it("overrides taskTimeoutMs", () => {
    const config = resolveConfig({ taskTimeoutMs: 5000 });
    expect(config.taskTimeoutMs).toBe(5000);
  });

  it("overrides specDirectories", () => {
    const config = resolveConfig({
      specDirectories: { flows: ["./custom-flows"], agents: ["./custom-specs"] },
    });
    expect(config.specDirectories!.flows).toEqual(["./custom-flows"]);
    expect(config.specDirectories!.agents).toEqual(["./custom-specs"]);
  });

  it("never mutates the DEFAULT constants", () => {
    const config = resolveConfig({ logLevel: LogLevel.DEBUG });
    expect(DEFAULT_FORGE_CONFIG.logLevel).toBe(LogLevel.INFO);
    expect(config.logLevel).toBe(LogLevel.DEBUG);
  });

  // Regression (3.21): resolveConfig used to hand out worktreeSymlinks,
  // specDirectories, display, and dev by reference from the defaults —
  // mutating the resolved config corrupted DEFAULT_FORGE_CONFIG.
  it("mutating a resolved config never corrupts DEFAULT_FORGE_CONFIG", () => {
    const config = resolveConfig({}) as unknown as {
      worktreeSymlinks: string[];
      display: { maxAgentEvents: number };
      dev: { enabled: boolean };
      specDirectories: { flows: string[]; agents: string[] };
    };
    config.worktreeSymlinks.push("hack");
    config.display.maxAgentEvents = 1;
    config.dev.enabled = true;
    config.specDirectories.flows.push("hack");
    config.specDirectories.agents.push("hack");

    expect(DEFAULT_FORGE_CONFIG.worktreeSymlinks).toEqual([]);
    expect(DEFAULT_FORGE_CONFIG.display.maxAgentEvents).toBe(200);
    expect(DEFAULT_FORGE_CONFIG.dev.enabled).toBe(false);
    expect(DEFAULT_FORGE_CONFIG.specDirectories.flows).toEqual([]);
    expect(DEFAULT_FORGE_CONFIG.specDirectories.agents).toEqual([]);
  });

  it("resolved nested structures are fresh objects, not defaults by reference", () => {
    const config1 = resolveConfig({});
    const config2 = resolveConfig({});
    expect(config1.worktreeSymlinks).not.toBe(DEFAULT_FORGE_CONFIG.worktreeSymlinks);
    expect(config1.specDirectories).not.toBe(DEFAULT_FORGE_CONFIG.specDirectories);
    expect(config1.display).not.toBe(DEFAULT_FORGE_CONFIG.display);
    expect(config1.dev).not.toBe(DEFAULT_FORGE_CONFIG.dev);
    expect(config1.worktreeSymlinks).not.toBe(config2.worktreeSymlinks);
    expect(config1.specDirectories).not.toBe(config2.specDirectories);
    expect(config1.display).not.toBe(config2.display);
    expect(config1.dev).not.toBe(config2.dev);
  });

  // Regression (F2): the defaults fallback handed out DEFAULT_FORGE_CONFIG.models
  // by reference when overrides.models was absent — mutating the resolved
  // config's models corrupted the process-wide defaults.
  it("mutating a resolved config's models never corrupts DEFAULT_FORGE_CONFIG.models", () => {
    const config = resolveConfig({}) as unknown as { models: Record<string, { model: string }> };
    expect(config.models).not.toBe(DEFAULT_FORGE_CONFIG.models);
    config.models.smart = { model: "hacked" };
    expect(DEFAULT_FORGE_CONFIG.models).toEqual({});
  });

  it("deep-clones override-provided nested structures", () => {
    const worktreeSymlinks = ["config"];
    const display = { maxAgentEvents: 5 };
    const dev = { enabled: true };
    const specDirectories = { flows: ["./f"], agents: ["./a"] };
    const config = resolveConfig({ worktreeSymlinks, display, dev, specDirectories });

    worktreeSymlinks.push("hack");
    display.maxAgentEvents = 1;
    dev.enabled = false;
    specDirectories.flows.push("hack");

    expect(config.worktreeSymlinks).toEqual(["config"]);
    expect(config.display?.maxAgentEvents).toBe(5);
    expect(config.dev?.enabled).toBe(true);
    expect(config.specDirectories?.flows).toEqual(["./f"]);
    expect(config.specDirectories?.agents).toEqual(["./a"]);
  });

  it("deep-clones override model presets", () => {
    const preset = { model: "claude-sonnet-4-5" };
    const config = resolveConfig({ models: { smart: preset } });
    preset.model = "hacked";
    expect(config.models.smart?.model).toBe("claude-sonnet-4-5");
    expect(config.models.smart).not.toBe(preset);
  });

  it("creates a fresh agents map each call", () => {
    const config1 = resolveConfig({});
    const config2 = resolveConfig({});
    expect(config1.agents).not.toBe(config2.agents);
  });

  it("creates a fresh defaultAgent object each call", () => {
    const config1 = resolveConfig({});
    const config2 = resolveConfig({});
    expect(config1.defaultAgent).not.toBe(config2.defaultAgent);
  });

  it("sets logLevel to DEBUG when dev mode is enabled with no explicit level", () => {
    const config = resolveConfig({ dev: { enabled: true } });
    expect(config.logLevel).toBe(LogLevel.DEBUG);
  });

  it("respects explicit logLevel even when dev mode is enabled", () => {
    const config = resolveConfig({ logLevel: LogLevel.WARN, dev: { enabled: true } });
    expect(config.logLevel).toBe(LogLevel.WARN);
  });

  describe("models defaults", () => {
    it("has default empty models map", () => {
      expect(DEFAULT_FORGE_CONFIG.models).toEqual({});
    });

    it("has default undefined defaultModel", () => {
      expect(DEFAULT_FORGE_CONFIG.defaultModel).toBeUndefined();
    });

    it("resolveConfig overrides models map", () => {
      const config = resolveConfig({
        models: {
          smart: { model: "claude-sonnet-4-5" },
        },
      });
      expect(config.models).toEqual({
        smart: { model: "claude-sonnet-4-5" },
      });
    });

    it("resolveConfig overrides defaultModel", () => {
      const config = resolveConfig({ defaultModel: "smart" });
      expect(config.defaultModel).toBe("smart");
    });

    it("resolveConfig shallow-clones models to prevent shared mutation", () => {
      const models = {
        smart: { model: "claude-sonnet-4-5" },
      };
      const config = resolveConfig({ models });
      models.smart = { model: "hacked" };
      expect(config.models.smart?.model).toBe("claude-sonnet-4-5");
    });
  });

  it("keeps default INFO level when dev mode is disabled", () => {
    const config = resolveConfig({ dev: { enabled: false } });
    expect(config.logLevel).toBe(LogLevel.INFO);
  });
});

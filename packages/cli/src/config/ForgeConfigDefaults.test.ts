import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_CONFIG, DEFAULT_FORGE_CONFIG, resolveConfig } from "./ForgeConfigDefaults";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

describe("DEFAULT_AGENT_CONFIG", () => {
  it("has a default model with a string identifier", () => {
    expect(DEFAULT_AGENT_CONFIG.model?.model).toBe("gpt-4");
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

  it("has default workspace provider GitWorktree", () => {
    expect(DEFAULT_FORGE_CONFIG.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
  });

  it("has an empty agents map", () => {
    expect(DEFAULT_FORGE_CONFIG.agents.size).toBe(0);
  });

  it("has default logDir .forge/logs", () => {
    expect(DEFAULT_FORGE_CONFIG.logDir).toBe(".forge/logs");
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
});

describe("resolveConfig", () => {
  it("returns defaults when called with empty overrides", () => {
    const config = resolveConfig({});
    expect(config.logLevel).toBe(LogLevel.INFO);
    expect(config.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
    expect(config.agents.size).toBe(0);
    expect(config.defaultAgent.model?.model).toBe("gpt-4");
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
});

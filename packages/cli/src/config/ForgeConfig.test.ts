import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "./ConfigError";
import { ForgeConfig } from "./ForgeConfig";
import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

describe("ForgeConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "forge-config-test-"));
  });

  afterEach(async () => {
    ForgeConfig.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("returns a ForgeConfig instance", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance).toBeInstanceOf(ForgeConfig);
    });

    it("returns the same instance on subsequent calls", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance1 = await ForgeConfig.create({ cwd: tempDir });
      const instance2 = await ForgeConfig.create({ cwd: tempDir });

      expect(instance1).toBe(instance2);
    });

    it("loads defaults when no config file exists", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      const config = instance.getConfig();

      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.workspaceProvider).toBe(DEFAULT_FORGE_CONFIG.workspaceProvider);
      expect(config.agents.size).toBe(0);
    });

    it("installs a SIGHUP handler on first create", async () => {
      const onSpy = vi.spyOn(process, "on");

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });

      expect(onSpy).toHaveBeenCalledWith("SIGHUP", expect.any(Function));
      onSpy.mockRestore();
    });

    it("does not install a second SIGHUP handler on repeated create calls", async () => {
      const onSpy = vi.spyOn(process, "on");

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });
      await ForgeConfig.create({ cwd: tempDir });

      // Should only have been called once
      expect(onSpy).toHaveBeenCalledTimes(1);
      onSpy.mockRestore();
    });
  });

  describe("getConfig", () => {
    it("returns the loaded configuration", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: { builder: { maxTurns: 50 } },
          defaultAgent: { model: { model: "claude-sonnet-4-5" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      const config = instance.getConfig();

      expect(config.logLevel).toBe(LogLevel.Warn);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
      expect(config.agents.get("builder")?.maxTurns).toBe(50);
    });

    it("returns a frozen object", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      const config = instance.getConfig();

      expect(Object.isFrozen(config)).toBe(true);
    });

    it("throws ConfigError when create has not been called", async () => {
      await ForgeConfig.create({ cwd: tempDir });
      ForgeConfig.destroy();

      // After destroy, the static _config is null. Calling getConfig
      // on the old instance (which reads _config) throws ConfigError.
      const instance = await ForgeConfig.create({ cwd: tempDir });
      ForgeConfig.destroy();

      expect(() => {
        instance.getConfig();
      }).toThrow(ConfigError);
    });
  });

  describe("reload", () => {
    it("replaces the frozen config with fresh data from disk", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getConfig().logLevel).toBe(LogLevel.Error);

      // Update the file
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.reload({ cwd: tempDir });
      expect(instance.getConfig().logLevel).toBe(LogLevel.Debug);
    });

    it("falls back to defaults when the file is removed before reload", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getConfig().logLevel).toBe(LogLevel.Error);

      // Remove the file
      await fs.rm(join(tempDir, "forge.config.json"));

      await ForgeConfig.reload({ cwd: tempDir });
      expect(instance.getConfig().logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
    });
  });

  describe("typed accessor methods", () => {
    it("returns the configured log level", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogLevel()).toBe(LogLevel.Error);
    });

    it("returns the configured log directory", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logDir: "/custom/logs",
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogDir()).toBe("/custom/logs");
    });

    it("falls back to .forge/logs when logDir not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogDir()).toBe(".forge/logs");
    });

    it("returns the configured worktree symlinks", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          worktreeSymlinks: ["config", "secrets"],
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getWorktreeSymlinks()).toEqual(["config", "secrets"]);
    });

    it("returns empty array when worktreeSymlinks not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getWorktreeSymlinks()).toEqual([]);
    });

    it("returns the configured task timeout", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          taskTimeoutMs: 5000,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getTaskTimeoutMs()).toBe(5000);
    });

    it("returns default 1 hour when taskTimeoutMs not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getTaskTimeoutMs()).toBe(60 * 60 * 1000);
    });

    it("returns the configured spec directories", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          specDirectories: {
            flows: ["custom-flows"],
            agents: ["custom-agents"],
          },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getSpecDirectories()).toEqual({
        flows: ["custom-flows"],
        agents: ["custom-agents"],
      });
    });

    it("returns empty spec directories when not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getSpecDirectories()).toEqual({ flows: [], agents: [] });
    });

    it("returns the configured flow directories", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          specDirectories: { flows: ["extra-flows"], agents: [] },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getFlowDirectories()).toEqual([join(tempDir, "extra-flows")]);
    });

    it("returns empty array when flow directories not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getFlowDirectories()).toEqual([]);
    });

    it("returns the configured agent spec directories", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          specDirectories: { flows: [], agents: ["extra-agent-specs"] },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getAgentSpecDirectories()).toEqual([join(tempDir, "extra-agent-specs")]);
    });

    it("returns empty array when agent spec directories not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getAgentSpecDirectories()).toEqual([]);
    });
  });

  describe("static instance getter", () => {
    it("returns the singleton instance when initialized", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(ForgeConfig.instance).toBe(instance);
    });

    it("returns undefined when not initialized", () => {
      expect(ForgeConfig.instance).toBeUndefined();
    });
  });

  describe("getInstance (nullable)", () => {
    it("returns the singleton instance when initialized", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });
      expect(ForgeConfig.getInstance()).toBeDefined();
    });

    it("returns undefined when not initialized", () => {
      expect(ForgeConfig.getInstance()).toBeUndefined();
    });

    it("returns undefined after destroy", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });
      ForgeConfig.destroy();
      expect(ForgeConfig.getInstance()).toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("removes the SIGHUP listener", async () => {
      const offSpy = vi.spyOn(process, "off");

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });
      ForgeConfig.destroy();

      expect(offSpy).toHaveBeenCalledWith("SIGHUP", expect.any(Function));
      offSpy.mockRestore();
    });

    it("allows create to re-initialize after destroy", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance1 = await ForgeConfig.create({ cwd: tempDir });
      expect(instance1.getConfig().logLevel).toBe(LogLevel.Debug);

      ForgeConfig.destroy();

      // Change the config on disk
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const instance2 = await ForgeConfig.create({ cwd: tempDir });
      expect(instance2.getConfig().logLevel).toBe(LogLevel.Warn);
      expect(instance2).not.toBe(instance1);
    });
  });
});

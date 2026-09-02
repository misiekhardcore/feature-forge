import * as fs from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigError } from "./ConfigError";
import { ForgeConfig } from "./ForgeConfig";
import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

describe("ForgeConfig", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Destroy any pre-initialized instance (e.g. from test-setup.ts)
    // so that each test starts with a clean slate.
    ForgeConfig.destroy();
    tempDir = await fs.mkdtemp(join(tmpdir(), "forge-config-test-"));
    // Isolate HOME so a real global ~/.forge/config.json on the host
    // cannot leak into the no-config default path (forRoot step 3).
    originalHome = process.env.HOME;
    process.env.HOME = join(tempDir, "home");
  });

  afterEach(async () => {
    ForgeConfig.destroy();
    process.env.HOME = originalHome;
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

      expect(config.logLevel).toBe(LogLevel.WARN);
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

    it("returns a deep-frozen object — nested structures cannot be mutated", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      const config = instance.getConfig();

      expect(Object.isFrozen(config.display!)).toBe(true);
      expect(Object.isFrozen(config.dev!)).toBe(true);
      expect(Object.isFrozen(config.worktreeSymlinks!)).toBe(true);
      expect(Object.isFrozen(config.specDirectories!)).toBe(true);
      expect(Object.isFrozen(config.agents)).toBe(true);
      expect(Object.isFrozen(config.defaultAgent)).toBe(true);
    });

    // Regression (3.21): the frozen config used to expose mutable nested
    // structures by reference — mutating them corrupted DEFAULT_FORGE_CONFIG.
    it("mutating the handed-out config never corrupts DEFAULT_FORGE_CONFIG", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      const config = instance.getConfig() as unknown as {
        worktreeSymlinks: string[];
        display: { maxAgentEvents: number };
        dev: { enabled: boolean };
        specDirectories: { flows: string[] };
      };

      expect(() => {
        config.worktreeSymlinks.push("hack");
      }).toThrow(TypeError);
      expect(() => {
        config.display.maxAgentEvents = 1;
      }).toThrow(TypeError);
      expect(() => {
        config.dev.enabled = true;
      }).toThrow(TypeError);
      expect(() => {
        config.specDirectories.flows.push("hack");
      }).toThrow(TypeError);

      expect(DEFAULT_FORGE_CONFIG.worktreeSymlinks).toEqual([]);
      expect(DEFAULT_FORGE_CONFIG.display.maxAgentEvents).toBe(200);
      expect(DEFAULT_FORGE_CONFIG.dev.enabled).toBe(false);
      expect(DEFAULT_FORGE_CONFIG.specDirectories.flows).toEqual([]);
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
      expect(instance.getConfig().logLevel).toBe(LogLevel.ERROR);

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
      expect(instance.getConfig().logLevel).toBe(LogLevel.DEBUG);
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
      expect(instance.getConfig().logLevel).toBe(LogLevel.ERROR);

      // Remove the file
      await fs.rm(join(tempDir, "forge.config.json"));

      await ForgeConfig.reload({ cwd: tempDir });
      expect(instance.getConfig().logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
    });
    it("reload without params reuses the cwd captured at create time", async () => {
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
      expect(instance.getConfig().logLevel).toBe(LogLevel.ERROR);

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.reload();
      expect(instance.getConfig().logLevel).toBe(LogLevel.DEBUG);
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
      expect(instance.getLogLevel()).toBe(LogLevel.ERROR);
    });

    it("returns the configured log directory", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logDir: "/custom/logs/",
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogDir()).toBe("/custom/logs/");
    });

    it("falls back to .forge/logs when logDir not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogDir()).toBe(".forge/logs/");
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

    it("returns the configured json retry max attempts", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          jsonRetryMaxAttempts: 5,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getJsonRetryMaxAttempts()).toBe(5);
    });

    it("returns default 2 when jsonRetryMaxAttempts not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getJsonRetryMaxAttempts()).toBe(2);
    });

    it("returns the configured log retention days", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logRetentionDays: 30,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogRetentionDays()).toBe(30);
    });

    it("returns default 7 when logRetentionDays not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogRetentionDays()).toBe(7);
    });

    it("returns the configured log max bytes", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logMaxBytes: 5242880,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogMaxBytes()).toBe(5242880);
    });

    it("returns default 10 MB when logMaxBytes not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogMaxBytes()).toBe(10 * 1024 * 1024);
    });

    it("returns the configured log max files", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logMaxFiles: 12,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogMaxFiles()).toBe(12);
    });

    it("returns default 5 when logMaxFiles not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogMaxFiles()).toBe(5);
    });

    it("returns the configured log payloads flag", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logPayloads: true,
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogPayloads()).toBe(true);
    });

    it("returns default false when logPayloads not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogPayloads()).toBe(false);
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

    it("returns the configured log prefix", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          logPrefix: "my-forge",
        }),
      );
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogPrefix()).toBe("my-forge");
    });

    it("falls back to the default log prefix when not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getLogPrefix()).toBe("forge");
    });

    it("returns the display config from the loaded config", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          display: { maxAgentEvents: 50, maxPreconnectBuffer: 500, maxOverlayHeight: 60 },
        }),
      );
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getDisplayConfig()).toEqual({
        maxAgentEvents: 50,
        maxPreconnectBuffer: 500,
        maxOverlayHeight: 60,
      });
      expect(instance.getDisplayMaxAgentEvents()).toBe(50);
      expect(instance.getDisplayMaxPreconnectBuffer()).toBe(500);
      expect(instance.getDisplayMaxOverlayHeight()).toBe("60");
    });

    it("falls back to the default display config when not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getDisplayMaxAgentEvents()).toBe(200);
      expect(instance.getDisplayMaxPreconnectBuffer()).toBe(2000);
      expect(instance.getDisplayMaxOverlayHeight()).toBe("85%");
    });

    it("keeps a percentage overlay height as-is", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          display: { maxOverlayHeight: "70%" },
        }),
      );
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getDisplayMaxOverlayHeight()).toBe("70%");
    });

    it("returns the dev config from the loaded config", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          dev: { enabled: true },
        }),
      );
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getDevConfig()).toEqual({ enabled: true });
      expect(instance.getDevEnabled()).toBe(true);
    });

    it("falls back to the default dev config when not configured", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getDevConfig()).toEqual({ enabled: false });
      expect(instance.getDevEnabled()).toBe(false);
    });

    it("resolves the forge dir relative to the project root", async () => {
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getForgeDir()).toBe(join(tempDir, ".forge"));
    });

    it("expands a tilde-prefixed forge dir against the home directory", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          forgeDir: "~/.forge",
        }),
      );
      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getForgeDir()).toBe(join(os.homedir(), ".forge"));
    });
    it("falls back to process.cwd() for flow directories when no cwd was captured", async () => {
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

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
      try {
        const instance = await ForgeConfig.create();
        expect(instance.getFlowDirectories()).toEqual([join(tempDir, "extra-flows")]);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it("falls back to process.cwd() for agent spec directories when no cwd was captured", async () => {
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

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
      try {
        const instance = await ForgeConfig.create();
        expect(instance.getAgentSpecDirectories()).toEqual([join(tempDir, "extra-agent-specs")]);
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });

  describe("getHideThinkingBlock", () => {
    /** Isolated fake home so tests never touch the real ~/.pi/agent. */
    let fakeHome: string;

    beforeEach(() => {
      fakeHome = join(tempDir, "home");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns false when no pi settings files exist", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(false);
    });

    it("returns true when the global settings file hides thinking blocks", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      const globalDir = join(fakeHome, ".pi", "agent");
      await fs.mkdir(globalDir, { recursive: true });
      await fs.writeFile(
        join(globalDir, "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("resolves the global settings dir from PI_CODING_AGENT_DIR", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", join(fakeHome, "custom-agent"));
      await fs.mkdir(join(fakeHome, "custom-agent"), { recursive: true });
      await fs.writeFile(
        join(fakeHome, "custom-agent", "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("tilde-expands PI_CODING_AGENT_DIR", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "~/custom-agent");
      await fs.mkdir(join(fakeHome, "custom-agent"), { recursive: true });
      await fs.writeFile(
        join(fakeHome, "custom-agent", "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("treats a bare tilde PI_CODING_AGENT_DIR as the home dir", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "~");
      await fs.mkdir(fakeHome, { recursive: true });
      await fs.writeFile(
        join(fakeHome, "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("returns true when the project settings file hides thinking blocks", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      await fs.mkdir(join(tempDir, ".pi"), { recursive: true });
      await fs.writeFile(
        join(tempDir, ".pi", "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("prefers the project settings value over the global one", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      const globalDir = join(fakeHome, ".pi", "agent");
      await fs.mkdir(globalDir, { recursive: true });
      await fs.writeFile(
        join(globalDir, "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );
      await fs.mkdir(join(tempDir, ".pi"), { recursive: true });
      await fs.writeFile(
        join(tempDir, ".pi", "settings.json"),
        JSON.stringify({ hideThinkingBlock: false }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(false);
    });

    it("falls back to the global value when the project file is missing", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      const globalDir = join(fakeHome, ".pi", "agent");
      await fs.mkdir(globalDir, { recursive: true });
      await fs.writeFile(
        join(globalDir, "settings.json"),
        JSON.stringify({ hideThinkingBlock: true }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);
    });

    it("tolerates malformed settings files", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      const globalDir = join(fakeHome, ".pi", "agent");
      await fs.mkdir(globalDir, { recursive: true });
      await fs.writeFile(join(globalDir, "settings.json"), "{ not valid json");
      await fs.mkdir(join(tempDir, ".pi"), { recursive: true });
      await fs.writeFile(join(tempDir, ".pi", "settings.json"), "{ not valid json");

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(false);
    });

    it("tolerates non-boolean hideThinkingBlock values", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      await fs.mkdir(join(tempDir, ".pi"), { recursive: true });
      await fs.writeFile(
        join(tempDir, ".pi", "settings.json"),
        JSON.stringify({ hideThinkingBlock: "yes" }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(false);
    });

    it("tolerates non-object settings files", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      await fs.mkdir(join(tempDir, ".pi"), { recursive: true });
      await fs.writeFile(join(tempDir, ".pi", "settings.json"), "[1, 2, 3]");

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(false);
    });

    it("re-reads settings fresh on every call", async () => {
      vi.stubEnv("HOME", fakeHome);
      vi.stubEnv("PI_CODING_AGENT_DIR", "");
      const globalDir = join(fakeHome, ".pi", "agent");
      await fs.mkdir(globalDir, { recursive: true });
      const settingsPath = join(globalDir, "settings.json");
      await fs.writeFile(settingsPath, JSON.stringify({ hideThinkingBlock: true }));

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getHideThinkingBlock()).toBe(true);

      // Toggle on disk — the next call must observe it (no caching).
      await fs.writeFile(settingsPath, JSON.stringify({ hideThinkingBlock: false }));
      expect(instance.getHideThinkingBlock()).toBe(false);
    });
  });

  describe("fallback defaults via the public API", () => {
    it("returns the default display and dev blocks when not configured", async () => {
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

      expect(instance.getDisplayConfig()).toEqual(DEFAULT_FORGE_CONFIG.display);
      expect(instance.getDevConfig()).toEqual(DEFAULT_FORGE_CONFIG.dev);
      expect(instance.getDisplayMaxAgentEvents()).toBe(DEFAULT_FORGE_CONFIG.display.maxAgentEvents);
      expect(instance.getDisplayMaxPreconnectBuffer()).toBe(
        DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer,
      );
      expect(instance.getDisplayMaxOverlayHeight()).toBe(
        String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight),
      );
      expect(instance.getDevEnabled()).toBe(false);
      expect(instance.getLogPrefix()).toBe(DEFAULT_FORGE_CONFIG.logPrefix);
      expect(instance.getForgeDir()).toBe(join(tempDir, ".forge"));
    });

    it("applies schema defaults to a partial display block and an empty dev block", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          display: { maxAgentEvents: 300 },
          dev: {},
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });

      // maxAgentEvents comes from the user; maxPreconnectBuffer from the
      // schema default; maxOverlayHeight has no schema default, so the
      // accessor falls back to the hard-coded default.
      expect(instance.getDisplayMaxAgentEvents()).toBe(300);
      expect(instance.getDisplayMaxPreconnectBuffer()).toBe(
        DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer,
      );
      expect(instance.getDisplayMaxOverlayHeight()).toBe(
        String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight),
      );
      expect(instance.getDevEnabled()).toBe(false);
    });

    it("returns empty arrays when specDirectories lacks nested keys", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          specDirectories: {},
        }),
      );

      const instance = await ForgeConfig.create({ cwd: tempDir });
      expect(instance.getFlowDirectories()).toEqual([]);
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
      expect(ForgeConfig.getInstance()).toBe(instance);
    });

    it("throws when not initialized", () => {
      expect(() => ForgeConfig.getInstance()).toThrow("Forge config not initialized");
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
      expect(instance1.getConfig().logLevel).toBe(LogLevel.DEBUG);

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
      expect(instance2.getConfig().logLevel).toBe(LogLevel.WARN);
      expect(instance2).not.toBe(instance1);
    });
  });
});

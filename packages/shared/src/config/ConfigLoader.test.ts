import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Logger } from "../logging/Logger";
import { InvalidConfigError, MissingConfigFileError } from "./ConfigError";
import { ConfigLoader } from "./ConfigLoader";
import { DEFAULT_AGENT_CONFIG, DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

describe("ConfigLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "config-loader-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("uses default options when no params are provided", () => {
      const loader = new ConfigLoader();
      expect(loader).toBeInstanceOf(ConfigLoader);
    });

    it("accepts a custom config file name", () => {
      const loader = new ConfigLoader({ configFileName: "custom.config" });
      expect(loader).toBeInstanceOf(ConfigLoader);
    });

    it("accepts custom extensions", () => {
      const loader = new ConfigLoader({ extensions: [".json"] });
      expect(loader).toBeInstanceOf(ConfigLoader);
    });
  });

  describe("loadFromFile", () => {
    it("loads a valid JSON config file", async () => {
      const filePath = join(tempDir, "forge.config.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: { builder: { maxTurns: 50 } },
          defaultAgent: { model: { model: "gpt-4" }, maxTurns: 100 },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      expect(config.logLevel).toBe(LogLevel.DEBUG);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
      expect(config.agents.size).toBe(1);
      expect(config.agents.get("builder")?.maxTurns).toBe(50);
      expect(config.defaultAgent.maxTurns).toBe(100);
    });

    it("loads a valid YAML config file", async () => {
      const filePath = join(tempDir, "forge.config.yaml");
      await fs.writeFile(
        filePath,
        [
          "logLevel: debug",
          "workspaceProvider: current-dir",
          "agents:",
          "  builder:",
          "    maxTurns: 50",
          "defaultAgent:",
          "  model:",
          '    model: "gpt-4"',
          "  maxTurns: 100",
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      expect(config.logLevel).toBe(LogLevel.DEBUG);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
      expect(config.agents.size).toBe(1);
      expect(config.agents.get("builder")?.maxTurns).toBe(50);
    });

    it("loads a YAML file with .yml extension", async () => {
      const filePath = join(tempDir, "forge.config.yml");
      await fs.writeFile(
        filePath,
        [
          "logLevel: info",
          "workspaceProvider: git-worktree",
          "agents: {}",
          "defaultAgent:",
          "  model:",
          '    model: "claude-sonnet-4-5"',
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      expect(config.logLevel).toBe(LogLevel.INFO);
      expect(config.defaultAgent.model?.model).toBe("claude-sonnet-4-5");
    });

    it("throws MissingConfigFileError when the file does not exist", async () => {
      const loader = new ConfigLoader();
      const missingPath = join(tempDir, "nonexistent.json");

      await expect(loader.loadFromFile(missingPath)).rejects.toThrow(MissingConfigFileError);
    });

    it("propagates cause when file does not exist", async () => {
      const loader = new ConfigLoader();
      const missingPath = join(tempDir, "nonexistent.json");

      try {
        await loader.loadFromFile(missingPath);
      } catch (error) {
        expect(error).toBeInstanceOf(MissingConfigFileError);
        expect((error as MissingConfigFileError).cause).toBeInstanceOf(Error);
      }
    });

    it("throws InvalidConfigError when the file contains invalid JSON", async () => {
      const filePath = join(tempDir, "bad.json");
      await fs.writeFile(filePath, "{ invalid json }");

      const loader = new ConfigLoader();

      const error: unknown = await loader.loadFromFile(filePath).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).cause).toBeInstanceOf(Error);
    });

    it("throws InvalidConfigError when the file contains invalid YAML", async () => {
      const filePath = join(tempDir, "bad.yaml");
      // Unclosed flow sequence - a genuine YAML syntax error. (A
      // mis-indented plain scalar like "key: value\n  bad indent" is
      // actually valid YAML: the second line continues the scalar.)
      await fs.writeFile(filePath, "key: [1, 2");

      const loader = new ConfigLoader();

      await expect(loader.loadFromFile(filePath)).rejects.toThrow(InvalidConfigError);
    });

    it("names 'valid YAML' as the expected format when YAML parsing fails", async () => {
      const filePath = join(tempDir, "tab-indented.yaml");
      await fs.writeFile(filePath, "a:\n\tb: c");

      const loader = new ConfigLoader();

      const error: unknown = await loader.loadFromFile(filePath).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).message).toContain("valid YAML");
    });

    it("truncates long invalid JSON content in the error message", async () => {
      const filePath = join(tempDir, "long-bad.json");
      await fs.writeFile(filePath, '"' + "x".repeat(300));

      const loader = new ConfigLoader();

      const error: unknown = await loader.loadFromFile(filePath).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidConfigError);
      const message = (error as InvalidConfigError).message;
      expect(message).toContain("...");
      expect(message).toContain("x".repeat(199));
      expect(message).not.toContain("x".repeat(300));
    });

    it("passes undefined cause when a parse error is not an Error instance", async () => {
      const filePath = join(tempDir, "forge.config.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberate defensive case
        throw "boom";
      });
      try {
        const loader = new ConfigLoader();
        const error: unknown = await loader.loadFromFile(filePath).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(InvalidConfigError);
        expect((error as InvalidConfigError).cause).toBeUndefined();
      } finally {
        parseSpy.mockRestore();
      }
    });

    it("throws InvalidConfigError when config fails schema validation", async () => {
      const filePath = join(tempDir, "invalid.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          logLevel: "unknown_level",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();

      const error: unknown = await loader.loadFromFile(filePath).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).cause).toBeInstanceOf(Error);
    });

    it("loads a config with only logPrefix, filling defaults for omitted fields", async () => {
      const filePath = join(tempDir, "minimal.json");
      await fs.writeFile(filePath, JSON.stringify({ logPrefix: "x" }));

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      expect(config.logPrefix).toBe("x");
      expect(config.logLevel).toBe(LogLevel.INFO);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
      expect(config.agents).toBeInstanceOf(Map);
      expect(config.agents.size).toBe(0);
      expect(config.defaultAgent).toEqual(DEFAULT_AGENT_CONFIG);
    });

    it("merges with defaults for omitted optional fields", async () => {
      const filePath = join(tempDir, "minimal.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      // defaultAgent fields not provided should use defaults
      expect(config.defaultAgent.maxToolCalls).toBe(DEFAULT_AGENT_CONFIG.maxToolCalls);
      expect(config.defaultAgent.maxTurns).toBe(DEFAULT_AGENT_CONFIG.maxTurns);
    });

    it("converts agents from Record to Map", async () => {
      const filePath = join(tempDir, "forge.config.json");
      await fs.writeFile(
        filePath,
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {
            alpha: { maxTurns: 10 },
            beta: { maxTurns: 20 },
          },
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.loadFromFile(filePath);

      expect(config.agents).toBeInstanceOf(Map);
      expect(config.agents.size).toBe(2);
      expect(config.agents.get("alpha")?.maxTurns).toBe(10);
      expect(config.agents.get("beta")?.maxTurns).toBe(20);
    });
  });

  describe("load (auto-discovery)", () => {
    it("discovers and loads a JSON config file in the search directory", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.DEBUG);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
    });

    it("discovers a YAML config file", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.yaml"),
        [
          "logLevel: debug",
          "workspaceProvider: current-dir",
          "agents: {}",
          "defaultAgent:",
          "  model:",
          '    model: "gpt-4"',
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader();
      const config = await loader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.DEBUG);
    });

    it("prefers .json over .yaml when both exist (extension order)", async () => {
      // Write both files — JSON should win (listed first in defaults)
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      await fs.writeFile(
        join(tempDir, "forge.config.yaml"),
        [
          "logLevel: debug",
          "workspaceProvider: current-dir",
          "agents: {}",
          "defaultAgent:",
          "  model:",
          '    model: "gpt-4"',
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader();
      const config = await loader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.ERROR);
    });

    it("returns default config when no config file exists", async () => {
      const emptyDir = join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      const loader = new ConfigLoader();
      const config = await loader.load({ cwd: emptyDir });

      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.workspaceProvider).toBe(DEFAULT_FORGE_CONFIG.workspaceProvider);
      expect(config.agents.size).toBe(0);
    });

    it("defaults to process.cwd() when no cwd is provided", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const spy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

      try {
        const loader = new ConfigLoader();
        const config = await loader.load();

        expect(config.logLevel).toBe(LogLevel.DEBUG);
      } finally {
        spy.mockRestore();
      }
    });

    it("respects custom configFileName during discovery", async () => {
      await fs.writeFile(
        join(tempDir, "custom.config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader({
        configFileName: "custom.config",
        extensions: [".json"],
      });
      const config = await loader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.WARN);
    });

    it("throws when discovered config file fails validation", async () => {
      // This test verifies that auto-discovery continues through extensions
      // even if a valid-looking file exists but has wrong format.
      // The loader tries extensions in order and loads the first accessible file.
      // Since file access succeeds but validation may fail, we test that
      // the file is indeed loaded (and throws).
      await fs.writeFile(join(tempDir, "forge.config.json"), "not valid json at all");

      const loader = new ConfigLoader();

      await expect(loader.load({ cwd: tempDir })).rejects.toThrow();
    });
  });

  describe("resolveEnvVars", () => {
    it("replaces ${VAR} with the environment variable value", () => {
      vi.stubEnv("MY_VAR", "debug");
      const loader = new ConfigLoader();
      const result = loader.resolveEnvVars("${MY_VAR}");
      expect(result).toBe("debug");
      vi.unstubAllEnvs();
    });

    it("replaces multiple env var references in a single string", () => {
      vi.stubEnv("HOST", "localhost");
      vi.stubEnv("PORT", "8080");
      const loader = new ConfigLoader();
      const result = loader.resolveEnvVars("${HOST}:${PORT}");
      expect(result).toBe("localhost:8080");
      vi.unstubAllEnvs();
    });

    it("replaces env vars in nested object values", () => {
      vi.stubEnv("LOG_LEVEL", "warn");
      const loader = new ConfigLoader();
      const input = { logging: { level: "${LOG_LEVEL}" } };
      const result = loader.resolveEnvVars(input);
      expect(result).toEqual({ logging: { level: "warn" } });
      vi.unstubAllEnvs();
    });

    it("replaces env vars in array elements", () => {
      vi.stubEnv("ITEM", "resolved");
      const loader = new ConfigLoader();
      const result = loader.resolveEnvVars(["${ITEM}", "static"]);
      expect(result).toEqual(["resolved", "static"]);
      vi.unstubAllEnvs();
    });

    it("returns empty string for undefined env vars", () => {
      const loader = new ConfigLoader();
      const result = loader.resolveEnvVars("${UNDEFINED_VAR}");
      expect(result).toBe("");
    });

    it("passes through strings without env var patterns", () => {
      const loader = new ConfigLoader();
      const result = loader.resolveEnvVars("plain string");
      expect(result).toBe("plain string");
    });

    it("passes through non-string primitives unchanged", () => {
      const loader = new ConfigLoader();
      expect(loader.resolveEnvVars(42)).toBe(42);
      expect(loader.resolveEnvVars(true)).toBe(true);
      expect(loader.resolveEnvVars(null)).toBeNull();
    });

    it("does not modify the original input object", () => {
      vi.stubEnv("TOKEN", "secret");
      const loader = new ConfigLoader();
      const original = { apiKey: "${TOKEN}" };
      const result = loader.resolveEnvVars(original);
      expect(result).toEqual({ apiKey: "secret" });
      expect(original).toEqual({ apiKey: "${TOKEN}" });
      vi.unstubAllEnvs();
    });
  });

  describe("buildEnvOverlay", () => {
    it("converts a single dot-path key to a nested object", () => {
      const loader = new ConfigLoader();
      const result = loader.buildEnvOverlay({ "logging.level": "debug" });
      expect(result).toEqual({ logging: { level: "debug" } });
    });

    it("handles deeply nested dot paths", () => {
      const loader = new ConfigLoader();
      const result = loader.buildEnvOverlay({ "a.b.c.d": "value" });
      expect(result).toEqual({ a: { b: { c: { d: "value" } } } });
    });

    it("merges multiple keys at different depths", () => {
      const loader = new ConfigLoader();
      const result = loader.buildEnvOverlay({
        "logging.level": "debug",
        "logging.file": "/var/log/app.log",
        "server.port": "3000",
      });
      expect(result).toEqual({
        logging: { level: "debug", file: "/var/log/app.log" },
        server: { port: "3000" },
      });
    });

    it("returns an empty object for empty input", () => {
      const loader = new ConfigLoader();
      const result = loader.buildEnvOverlay({});
      expect(result).toEqual({});
    });

    it("treats a single-part key as a top-level property", () => {
      const loader = new ConfigLoader();
      const result = loader.buildEnvOverlay({ top: "value" });
      expect(result).toEqual({ top: "value" });
    });
  });

  describe("resolveForgeEnvOverlay", () => {
    // Point HOME at an empty dir so forRoot never falls through to a real
    // global ~/.forge/config.json — the default-asserting tests below must
    // not depend on the machine's ambient config.
    beforeEach(async () => {
      const fakeHome = join(tempDir, "empty-home");
      await fs.mkdir(fakeHome, { recursive: true });
      vi.stubEnv("HOME", fakeHome);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("extracts logPrefix from a valid FORGE_SPEC", async () => {
      vi.stubEnv("FORGE_SPEC", JSON.stringify({ id: "builder-a3f8c2" }));

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logPrefix).toBe("builder-a3f8c2");
    });

    it("ignores FORGE_SPEC without an id", async () => {
      vi.stubEnv("FORGE_SPEC", JSON.stringify({ name: "builder" }));

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logPrefix).toBe(DEFAULT_FORGE_CONFIG.logPrefix);
    });

    it("ignores malformed FORGE_SPEC", async () => {
      vi.stubEnv("FORGE_SPEC", "{ not json");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logPrefix).toBe(DEFAULT_FORGE_CONFIG.logPrefix);
    });

    it("parses a valid FORGE_TASK_TIMEOUT_MS", async () => {
      vi.stubEnv("FORGE_TASK_TIMEOUT_MS", "5000");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.taskTimeoutMs).toBe(5000);
    });

    it("skips a non-numeric FORGE_TASK_TIMEOUT_MS", async () => {
      vi.stubEnv("FORGE_TASK_TIMEOUT_MS", "not-a-number");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.taskTimeoutMs).toBe(DEFAULT_FORGE_CONFIG.taskTimeoutMs);
    });

    it("uses FORGE_LOG_DIR verbatim", async () => {
      vi.stubEnv("FORGE_LOG_DIR", "custom-logs");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logDir).toBe("custom-logs");
    });

    it("splits FORGE_WORKTREE_SYMLINKS on commas", async () => {
      vi.stubEnv("FORGE_WORKTREE_SYMLINKS", "config, secrets");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.worktreeSymlinks).toEqual(["config", "secrets"]);
    });

    it("ignores an empty FORGE_WORKTREE_SYMLINKS", async () => {
      vi.stubEnv("FORGE_WORKTREE_SYMLINKS", "");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.worktreeSymlinks).toEqual(DEFAULT_FORGE_CONFIG.worktreeSymlinks);
    });

    it("sets dev.enabled from FORGE_DEV '1'", async () => {
      vi.stubEnv("FORGE_DEV", "1");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.dev?.enabled).toBe(true);
    });

    it("sets dev.enabled from FORGE_DEV 'true'", async () => {
      vi.stubEnv("FORGE_DEV", "true");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.dev?.enabled).toBe(true);
    });

    it("sets dev.enabled to false for a non-truthy FORGE_DEV", async () => {
      vi.stubEnv("FORGE_DEV", "0");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.dev?.enabled).toBe(false);
    });
  });

  describe("forRoot", () => {
    it("loads a valid .json config file from the search directory", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.DEBUG);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
    });

    it("prefers .forge/config.json over forge.config.json", async () => {
      // Write both files with different values
      const forgeDir = join(tempDir, ".forge");
      await fs.mkdir(forgeDir, { recursive: true });
      await fs.writeFile(
        join(forgeDir, "config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      // Should prefer .forge/config.json
      expect(config.logLevel).toBe(LogLevel.ERROR);
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.GitWorktree);
    });

    it("only searches for .json files, ignoring .yaml", async () => {
      // Write only a .yaml file — forRoot should not find it and return defaults
      await fs.writeFile(
        join(tempDir, "forge.config.yaml"),
        [
          "logLevel: debug",
          "workspaceProvider: current-dir",
          "agents: {}",
          "defaultAgent:",
          "  model:",
          '    model: "gpt-4"',
          "",
        ].join("\n"),
      );

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      // Should return defaults since only .yaml exists
      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.workspaceProvider).toBe(DEFAULT_FORGE_CONFIG.workspaceProvider);
    });

    it("returns defaults when no config file exists", async () => {
      const emptyDir = join(tempDir, "empty");
      await fs.mkdir(emptyDir, { recursive: true });

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: emptyDir });

      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.agents.size).toBe(0);
    });

    it("returns defaults when config file has invalid JSON and logs a warning", async () => {
      await fs.writeFile(join(tempDir, "forge.config.json"), "not valid json at all");

      // Pin the logger to the base console fallback so this test does not
      // depend on whichever logger earlier tests initialized (or on the
      // singleton being at warn-or-lower level).
      Logger.resetForTest();
      Logger.initialize();
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const loader = new ConfigLoader();
        const config = await loader.forRoot({ cwd: tempDir });

        expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid JSON"));
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it("prefers .forge/config.json even when forge.config.json has invalid JSON", async () => {
      // Valid .forge/config.json but invalid forge.config.json
      const forgeDir = join(tempDir, ".forge");
      await fs.mkdir(forgeDir, { recursive: true });
      await fs.writeFile(
        join(forgeDir, "config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      await fs.writeFile(join(tempDir, "forge.config.json"), "not valid json at all");

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      // .forge/config.json is found first, so forge.config.json is never read
      expect(config.logLevel).toBe(LogLevel.WARN);
    });

    it("resolves env vars in the loaded config", async () => {
      vi.stubEnv("FORGE_LOG_LEVEL", "error");

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "${FORGE_LOG_LEVEL}",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();
      const config = await loader.forRoot({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.ERROR);
      vi.unstubAllEnvs();
    });

    it("throws InvalidConfigError when the config fails validation after env var resolution", async () => {
      vi.stubEnv("FORGE_LOG_LEVEL", "invalid_level");

      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "${FORGE_LOG_LEVEL}",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const loader = new ConfigLoader();

      await expect(loader.forRoot({ cwd: tempDir })).rejects.toThrow(InvalidConfigError);
      vi.unstubAllEnvs();
    });

    it("defaults to process.cwd() when no cwd is provided", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const spy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);

      try {
        const loader = new ConfigLoader();
        const config = await loader.forRoot();

        expect(config.logLevel).toBe(LogLevel.WARN);
      } finally {
        spy.mockRestore();
      }
    });

    it("resolves a ~/.forge pointer to the home directory, not the filesystem root", async () => {
      // Project pointer file
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      await fs.writeFile(
        join(projectForgeDir, "config.json"),
        JSON.stringify({ forgeDir: "~/.forge" }),
      );

      // Fake home directory with the real global config
      const fakeHome = join(tempDir, "home");
      const fakeGlobalForge = join(fakeHome, ".forge");
      await fs.mkdir(fakeGlobalForge, { recursive: true });
      await fs.writeFile(
        join(fakeGlobalForge, "config.json"),
        JSON.stringify({
          logLevel: "debug",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
          forgeDir: ".forge",
        }),
      );

      vi.stubEnv("HOME", fakeHome);
      try {
        const loader = new ConfigLoader();
        const config = await loader.forRoot({ cwd: tempDir });

        expect(config.logLevel).toBe(LogLevel.DEBUG);
        expect(config.forgeDir).toBe("~/.forge");
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("throws MissingConfigFileError when a pointer's target config is missing", async () => {
      // Project pointer file pointing at ~/.forge, but the fake home has no
      // .forge/config.json — the error should name the missing target file.
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      await fs.writeFile(
        join(projectForgeDir, "config.json"),
        JSON.stringify({ forgeDir: "~/.forge" }),
      );

      const fakeHome = join(tempDir, "home");
      await fs.mkdir(fakeHome, { recursive: true });

      vi.stubEnv("HOME", fakeHome);
      try {
        const loader = new ConfigLoader();
        const error: unknown = await loader.forRoot({ cwd: tempDir }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MissingConfigFileError);
        expect((error as Error).message).toContain(fakeHome);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("resolves a relative forgeDir pointer against process.cwd()", async () => {
      // Project pointer file with a relative forgeDir — the real config is
      // resolved against process.cwd(), so mock it to the temp dir.
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      await fs.writeFile(
        join(projectForgeDir, "config.json"),
        JSON.stringify({ forgeDir: "custom-forge" }),
      );

      const customDir = join(tempDir, "custom-forge");
      await fs.mkdir(customDir, { recursive: true });
      await fs.writeFile(
        join(customDir, "config.json"),
        JSON.stringify({
          logLevel: "warn",
          workspaceProvider: "current-dir",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
      try {
        const loader = new ConfigLoader();
        const config = await loader.forRoot({ cwd: tempDir });

        expect(config.logLevel).toBe(LogLevel.WARN);
        expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
      } finally {
        cwdSpy.mockRestore();
      }
    });
  });

  describe("resolveForgeEnvOverlay", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("returns an empty overlay when no forge env vars are set", () => {
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("derives logPrefix from the FORGE_SPEC id", () => {
      vi.stubEnv("FORGE_SPEC", JSON.stringify({ id: "builder-abc123" }));
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ logPrefix: "builder-abc123" });
    });

    it("ignores malformed FORGE_SPEC", () => {
      vi.stubEnv("FORGE_SPEC", "not-json{");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("ignores FORGE_SPEC without an id", () => {
      vi.stubEnv("FORGE_SPEC", JSON.stringify({ role: "builder" }));
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("accepts a valid FORGE_TASK_TIMEOUT_MS", () => {
      vi.stubEnv("FORGE_TASK_TIMEOUT_MS", "5000");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ taskTimeoutMs: 5000 });
    });

    it("ignores an invalid FORGE_TASK_TIMEOUT_MS", () => {
      vi.stubEnv("FORGE_TASK_TIMEOUT_MS", "abc");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("ignores a zero FORGE_TASK_TIMEOUT_MS", () => {
      vi.stubEnv("FORGE_TASK_TIMEOUT_MS", "0");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("accepts a valid FORGE_LOG_LEVEL", () => {
      vi.stubEnv("FORGE_LOG_LEVEL", "debug");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ logLevel: "debug" });
    });

    it("ignores an unknown FORGE_LOG_LEVEL", () => {
      vi.stubEnv("FORGE_LOG_LEVEL", "verbose");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("accepts FORGE_LOG_DIR", () => {
      vi.stubEnv("FORGE_LOG_DIR", "/tmp/logs");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ logDir: "/tmp/logs" });
    });

    it("splits FORGE_WORKTREE_SYMLINKS into trimmed entries", () => {
      vi.stubEnv("FORGE_WORKTREE_SYMLINKS", "config, secrets");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ worktreeSymlinks: ["config", "secrets"] });
    });

    it("ignores an empty FORGE_WORKTREE_SYMLINKS", () => {
      vi.stubEnv("FORGE_WORKTREE_SYMLINKS", "");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({});
    });

    it("accepts FORGE_DEV numeric true", () => {
      vi.stubEnv("FORGE_DEV", "1");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ dev: { enabled: true } });
    });

    it("accepts FORGE_DEV case-insensitive true", () => {
      vi.stubEnv("FORGE_DEV", "TRUE");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ dev: { enabled: true } });
    });

    it("accepts FORGE_DEV false", () => {
      vi.stubEnv("FORGE_DEV", "false");
      const loader = new ConfigLoader();
      expect(loader.resolveForgeEnvOverlay()).toEqual({ dev: { enabled: false } });
    });
  });
});

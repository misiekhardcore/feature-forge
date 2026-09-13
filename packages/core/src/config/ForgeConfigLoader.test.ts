import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvalidConfigError } from "./ConfigError";
import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import { ForgeConfigLoader } from "./ForgeConfigLoader";
import { LogLevel, WorkspaceProviderKind } from "./ForgeConfigSchema";

/** FORGE_* overlay vars ConfigLoader.forRoot applies on every load. */
const FORGE_ENV_VARS = [
  "FORGE_LOG_LEVEL",
  "FORGE_LOG_DIR",
  "FORGE_SPEC",
  "FORGE_DEV",
  "FORGE_TASK_TIMEOUT_MS",
  "FORGE_WORKTREE_SYMLINKS",
] as const;

describe("ForgeConfigLoader", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalForgeEnv: Array<readonly [string, string | undefined]>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "forge-config-loader-test-"));
    // Isolate HOME so a real global ~/.forge/config.json on the host
    // cannot leak into the no-config default path (forRoot step 3).
    originalHome = process.env.HOME;
    process.env.HOME = join(tempDir, "home");
    // Scrub FORGE_* overlays so host/CI exports cannot leak into loads.
    originalForgeEnv = FORGE_ENV_VARS.map((name) => [name, process.env[name]] as const);
    for (const name of FORGE_ENV_VARS) {
      delete process.env[name];
    }
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    for (const [name, value] of originalForgeEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("returns a resolved config built from defaults when no config file exists", async () => {
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.workspaceProvider).toBe(DEFAULT_FORGE_CONFIG.workspaceProvider);
      expect(config.logDir).toBe(DEFAULT_FORGE_CONFIG.logDir);
      // Default-fallback regression (moved from the retired ForgeConfig
      // class spec): unconfigured scalars resolve to their canonical
      // defaults through the load path.
      expect(config.jsonRetryMaxAttempts).toBe(DEFAULT_FORGE_CONFIG.jsonRetryMaxAttempts);
      expect(config.agents.size).toBe(0);
      expect(config.specDirectories).toEqual({ flows: [], agents: [] });
    });

    it("loads and merges a project-level .forge/config.json", async () => {
      const forgeDir = join(tempDir, ".forge");
      await fs.mkdir(forgeDir, { recursive: true });
      await fs.writeFile(
        join(forgeDir, "config.json"),
        JSON.stringify({
          logLevel: "warn",
          logPrefix: "my-forge",
          workspaceProvider: "current-dir",
          defaultAgent: { model: { model: "claude-sonnet-4-5" } },
        }),
      );

      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.WARN);
      expect(config.logPrefix).toBe("my-forge");
      expect(config.workspaceProvider).toBe(WorkspaceProviderKind.CurrentDir);
      // Omitted fields still come from defaults.
      expect(config.logDir).toBe(DEFAULT_FORGE_CONFIG.logDir);
    });

    it("ignores a legacy forge.config.json at the project root", async () => {
      await fs.writeFile(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "debug",
          logPrefix: "legacy-root",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      // forRoot only consults <cwd>/.forge/config.json and
      // ~/.forge/config.json - a root forge.config.json is dead config.
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(DEFAULT_FORGE_CONFIG.logLevel);
      expect(config.logPrefix).toBe(DEFAULT_FORGE_CONFIG.logPrefix);
    });

    it("falls back to the global ~/.forge/config.json when no project config exists", async () => {
      const homeDir = join(tempDir, "home");
      await fs.mkdir(join(homeDir, ".forge"), { recursive: true });
      await fs.writeFile(
        join(homeDir, ".forge", "config.json"),
        JSON.stringify({
          logLevel: "error",
          logPrefix: "global-forge",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(config.logLevel).toBe(LogLevel.ERROR);
      expect(config.logPrefix).toBe("global-forge");
    });

    it("loads fine when the project file carries a leftover forgeDir pointer key (dropped from the result)", async () => {
      // Fixed homes: global lives at ~/.forge/config.json (HOME is stubbed
      // to tempDir/home), project lives at <cwd>/.forge/config.json.
      const globalForgeDir = join(tempDir, "home", ".forge");
      await fs.mkdir(globalForgeDir, { recursive: true });
      await fs.writeFile(
        join(globalForgeDir, "config.json"),
        JSON.stringify({
          logLevel: "info",
          logPrefix: "base-config",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      await fs.writeFile(
        join(projectForgeDir, "config.json"),
        JSON.stringify({
          // Old pointer shape - validates as an unknown key (open schema)
          // and is dropped at resolution; never followed.
          forgeDir: "~/.forge",
          logLevel: "warn",
        }),
      );

      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      // Project wins per top-level key; keys the project omits (logPrefix)
      // fall back to the global file. The leftover forgeDir key does not
      // appear anywhere in the resolved config.
      expect(config.logLevel).toBe(LogLevel.WARN);
      expect(config.logPrefix).toBe("base-config");
      expect(config).not.toHaveProperty("forgeDir");
    });

    it("propagates schema-validation errors from a project config file", async () => {
      const forgeDir = join(tempDir, ".forge");
      await fs.mkdir(forgeDir, { recursive: true });
      await fs.writeFile(join(forgeDir, "config.json"), JSON.stringify({ logLevel: 42 }));

      await expect(ForgeConfigLoader.load({ cwd: tempDir })).rejects.toBeInstanceOf(
        InvalidConfigError,
      );
    });

    it("defaults the search directory to process.cwd() when no cwd is provided", async () => {
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      await fs.writeFile(
        join(projectForgeDir, "config.json"),
        JSON.stringify({
          logLevel: "debug",
          logPrefix: "cwd-default",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
      try {
        const config = await ForgeConfigLoader.load();
        expect(config.logPrefix).toBe("cwd-default");
        expect(config.logLevel).toBe(LogLevel.DEBUG);
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it("returns a deep-frozen config - nested structures cannot be mutated", async () => {
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.agents)).toBe(true);
      expect(Object.isFrozen(config.display!)).toBe(true);
      expect(Object.isFrozen(config.dev!)).toBe(true);
      expect(Object.isFrozen(config.specDirectories!)).toBe(true);

      // Cast through `unknown` to a mutable shape (sibling freeze-spec
      // pattern) so the mutation attempts compile regardless of how the
      // schema's readonly modifiers are statically resolved.
      const mutable = config as unknown as {
        worktreeSymlinks: string[];
        agents: Map<string, unknown>;
      };
      expect(() => {
        mutable.worktreeSymlinks.push("hack");
      }).toThrow(TypeError);
      expect(() => {
        mutable.agents.set("hack", {});
      }).toThrow(TypeError);
    });

    it("re-loads from disk on every call (no singleton caching)", async () => {
      const projectForgeDir = join(tempDir, ".forge");
      await fs.mkdir(projectForgeDir, { recursive: true });
      const configPath = join(projectForgeDir, "config.json");

      await fs.writeFile(
        configPath,
        JSON.stringify({
          logLevel: "debug",
          logPrefix: "first-load",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      const first = await ForgeConfigLoader.load({ cwd: tempDir });
      expect(first.logPrefix).toBe("first-load");

      await fs.writeFile(
        configPath,
        JSON.stringify({
          logLevel: "error",
          logPrefix: "second-load",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );
      const second = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(second.logPrefix).toBe("second-load");
      expect(second.logLevel).toBe(LogLevel.ERROR);
      expect(second).not.toBe(first);
    });

    it("does not install a SIGHUP listener on repeated load() calls", async () => {
      const onSpy = vi.spyOn(process, "on");
      try {
        await ForgeConfigLoader.load({ cwd: tempDir });
        await ForgeConfigLoader.load({ cwd: tempDir });

        // The legacy ForgeConfig singleton registers a SIGHUP auto-reload
        // handler; the stateless loader must not install any process
        // listeners (reload semantics are the caller's to control).
        expect(onSpy).not.toHaveBeenCalledWith("SIGHUP", expect.any(Function));
      } finally {
        onSpy.mockRestore();
      }
    });
  });
});

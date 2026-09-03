import * as fs from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import { ForgeConfigLoader } from "./ForgeConfigLoader";
import { ForgeConfigPaths } from "./ForgeConfigPaths";
import type { ForgeConfig } from "./ForgeConfigSchema";

/** FORGE_* overlay vars ConfigLoader.forRoot applies on every load. */
const FORGE_ENV_VARS = [
  "FORGE_LOG_LEVEL",
  "FORGE_LOG_DIR",
  "FORGE_SPEC",
  "FORGE_DEV",
  "FORGE_TASK_TIMEOUT_MS",
  "FORGE_WORKTREE_SYMLINKS",
] as const;

describe("ForgeConfigPaths", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalForgeEnv: Array<readonly [string, string | undefined]>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "forge-config-paths-test-"));
    // Isolate HOME so tilde expansion and the global-config lookup
    // (forRoot step 3) never touch the real ~/.forge on the host.
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

  /** Load the resolved config for a root-level config file (legacy location). */
  async function loadWithConfig(overrides: Record<string, unknown>): Promise<ForgeConfig> {
    await fs.writeFile(
      join(tempDir, "forge.config.json"),
      JSON.stringify({
        logLevel: "info",
        workspaceProvider: "git-worktree",
        agents: {},
        defaultAgent: { model: { model: "gpt-4" } },
        ...overrides,
      }),
    );
    return ForgeConfigLoader.load({ cwd: tempDir });
  }

  describe("resolveForgeDir", () => {
    it("resolves the default forge dir against the project root", async () => {
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(ForgeConfigPaths.resolveForgeDir(config, tempDir)).toBe(
        join(tempDir, DEFAULT_FORGE_CONFIG.forgeDir!),
      );
    });

    it("resolves a configured relative forge dir against the project root", async () => {
      const config = await loadWithConfig({ forgeDir: "custom-forge" });

      expect(ForgeConfigPaths.resolveForgeDir(config, tempDir)).toBe(join(tempDir, "custom-forge"));
    });

    it("expands a tilde-prefixed forge dir against the home directory", async () => {
      const config = await loadWithConfig({ forgeDir: "~/.forge" });

      expect(ForgeConfigPaths.resolveForgeDir(config, tempDir)).toBe(join(os.homedir(), ".forge"));
    });

    it("strips the tilde from a ~user/... forge dir against the home directory", async () => {
      // Parity with the legacy accessor: any leading `~` is home-relative;
      // `~user/...` becomes `<homedir>/user/...` (only the tilde is
      // stripped - it is NOT resolved to that user's real home).
      const config = await loadWithConfig({ forgeDir: "~deploy/.forge" });

      expect(ForgeConfigPaths.resolveForgeDir(config, tempDir)).toBe(
        join(os.homedir(), "deploy", ".forge"),
      );
    });

    it("keeps an already-absolute forge dir unchanged", async () => {
      const config = await loadWithConfig({ forgeDir: "/var/lib/forge" });

      expect(ForgeConfigPaths.resolveForgeDir(config, tempDir)).toBe("/var/lib/forge");
    });
  });

  describe("resolveFlowDirectories", () => {
    it("returns an empty array when no flow directories are configured", async () => {
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(ForgeConfigPaths.resolveFlowDirectories(config, tempDir)).toEqual([]);
    });

    it("resolves relative flow directories against the project root, in order", async () => {
      const config = await loadWithConfig({
        specDirectories: { flows: ["custom-flows", "nested/flows", "/abs/flows"] },
      });

      expect(ForgeConfigPaths.resolveFlowDirectories(config, tempDir)).toEqual([
        join(tempDir, "custom-flows"),
        join(tempDir, "nested", "flows"),
        "/abs/flows",
      ]);
    });
  });

  describe("resolveAgentSpecDirectories", () => {
    it("returns an empty array when no agent-spec directories are configured", async () => {
      const config = await ForgeConfigLoader.load({ cwd: tempDir });

      expect(ForgeConfigPaths.resolveAgentSpecDirectories(config, tempDir)).toEqual([]);
    });

    it("resolves relative agent-spec directories against the project root", async () => {
      const config = await loadWithConfig({
        specDirectories: { agents: ["extra-agent-specs", "shared/specs"] },
      });

      expect(ForgeConfigPaths.resolveAgentSpecDirectories(config, tempDir)).toEqual([
        join(tempDir, "extra-agent-specs"),
        join(tempDir, "shared", "specs"),
      ]);
    });
  });

  describe("fallbacks for partial config objects", () => {
    it("treats a config without path fields as fully defaulted", () => {
      const partial = { agents: new Map() } as unknown as Readonly<ForgeConfig>;

      expect(ForgeConfigPaths.resolveForgeDir(partial, tempDir)).toBe(
        join(tempDir, DEFAULT_FORGE_CONFIG.forgeDir!),
      );
      expect(ForgeConfigPaths.resolveFlowDirectories(partial, tempDir)).toEqual([]);
      expect(ForgeConfigPaths.resolveAgentSpecDirectories(partial, tempDir)).toEqual([]);
    });
  });
});

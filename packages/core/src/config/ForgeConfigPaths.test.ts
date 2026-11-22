import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
    // Isolate HOME so os.homedir() and the global-config lookup (forRoot
    // step 2) never touch the real ~/.forge on the host.
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

  /** Load the resolved config for a project-level .forge/config.json. */
  async function loadWithConfig(overrides: Record<string, unknown>): Promise<ForgeConfig> {
    await fs.mkdir(join(tempDir, ".forge"), { recursive: true });
    await fs.writeFile(
      join(tempDir, ".forge", "config.json"),
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

  describe("resolveProjectHome", () => {
    it("joins the project cwd with .forge (no tilde/config involvement)", () => {
      const cwd = join(os.tmpdir(), "some", "project");

      expect(ForgeConfigPaths.resolveProjectHome(cwd)).toBe(join(cwd, ".forge"));
    });

    it("normalizes a cwd with a trailing slash", () => {
      const cwd = join(os.tmpdir(), "some", "project");

      // A trailing slash on the input must not double up or change the
      // resolved home (path.join normalizes both sides).
      expect(ForgeConfigPaths.resolveProjectHome(`${cwd}/`)).toBe(join(cwd, ".forge"));
    });
  });

  describe("resolveGlobalHome", () => {
    it("resolves ~/.forge against the current user's home directory", () => {
      expect(ForgeConfigPaths.resolveGlobalHome()).toBe(join(os.homedir(), ".forge"));
    });

    it("follows a stubbed HOME (the fixed global home is home-derived)", () => {
      const stubbedHome = join(tempDir, "stub-home");
      process.env.HOME = stubbedHome;

      expect(ForgeConfigPaths.resolveGlobalHome()).toBe(join(stubbedHome, ".forge"));
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

  describe("packaged install layout", () => {
    // The vitest module dir is packages/core/src/config, so the packaged
    // probe resolves the core SOURCE root (which holds the markers) and
    // the packaged dirs below it. These tests pin the dev-layout probe -
    // the meaningful case for CI and in-process boots; no temp-dir
    // overfitting.
    const coreSrc = fileURLToPath(new URL("..", import.meta.url));

    it("resolves the packaged agents dir to the source templates in the dev layout", () => {
      const resolved = ForgeConfigPaths.resolvePackagedAgentsDir();

      expect(resolved).toBe(join(coreSrc, "agents", "specifications", "templates"));
      // Marker sanity: the resolved dir holds the declarative spec files.
      expect(existsSync(join(coreSrc, "agents", "specifications", "templates", "build.md"))).toBe(
        true,
      );
    });

    it("resolves the packaged flows dir to the flow definitions in the dev layout", () => {
      const resolved = ForgeConfigPaths.resolvePackagedFlowsDir();

      expect(resolved).toBe(join(coreSrc, "flows", "definitions"));
      expect(existsSync(join(coreSrc, "flows", "definitions", "implement", "flow.json"))).toBe(
        true,
      );
    });

    it("resolves the packaged skills dir to the core source skills in the dev layout", () => {
      const resolved = ForgeConfigPaths.resolvePackagedSkillsDir();

      expect(resolved).toBe(join(coreSrc, "skills"));
      expect(existsSync(join(coreSrc, "skills", "forge-build", "SKILL.md"))).toBe(true);
    });
  });

  describe("fallbacks for partial config objects", () => {
    it("treats a config without specDirectory fields as fully defaulted", () => {
      const partial = { agents: new Map() } as unknown as Readonly<ForgeConfig>;

      expect(ForgeConfigPaths.resolveFlowDirectories(partial, tempDir)).toEqual([]);
      expect(ForgeConfigPaths.resolveAgentSpecDirectories(partial, tempDir)).toEqual([]);
    });
  });
});

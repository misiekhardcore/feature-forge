import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DEFAULT_FORGE_CONFIG, type ForgeConfigData } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentViewerConfig } from "./AgentViewerConfig";

/**
 * The adapter carries the viewer-config resolution semantics that survive
 * the ForgeConfig class removal (Phase 3a / S11): DEFAULT_FORGE_CONFIG
 * fallbacks for partial configs, number-to-string overlay-height coercion,
 * and the pi settings.json merge behind getHideThinkingBlock. These specs
 * pin those semantics directly on the adapter.
 */
describe("AgentViewerConfig", () => {
  let tempRoot: string;
  let home: string;
  let projectCwd: string;
  let globalSettingsPath: string;
  let projectSettingsPath: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(join(tmpdir(), "forge-viewer-config-test-"));
    // Isolate pi's agent dir so a real global settings file on the host
    // (or a real $PI_CODING_AGENT_DIR from the running session) cannot leak
    // into getHideThinkingBlock's resolution.
    home = join(tempRoot, "home");
    projectCwd = join(tempRoot, "project");
    await fs.mkdir(projectCwd, { recursive: true });
    globalSettingsPath = join(home, ".pi", "agent", "settings.json");
    projectSettingsPath = join(projectCwd, ".pi", "settings.json");
    vi.stubEnv("HOME", home);
    vi.stubEnv("PI_CODING_AGENT_DIR", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  /**
   * Build an adapter over a config that may omit optional fields. The
   * adapter reads defensively (DEFAULT_FORGE_CONFIG covers every gap), so
   * partial inputs are legitimate; the type requires the resolved shape.
   */
  function makeAdapter(
    config: Readonly<Partial<ForgeConfigData>> = {},
    cwd: string = projectCwd,
  ): AgentViewerConfig {
    return new AgentViewerConfig(config as Readonly<ForgeConfigData>, cwd);
  }

  /** Write a pi settings.json, creating parent directories. */
  async function writeSettings(filePath: string, contents: unknown): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
  }

  describe("log accessors", () => {
    it("returns the configured log dir and retention days", () => {
      const adapter = makeAdapter({ logDir: "custom/logs", logRetentionDays: 3 });

      expect(adapter.getLogDir()).toBe("custom/logs");
      expect(adapter.getLogRetentionDays()).toBe(3);
    });

    it("falls back to the canonical defaults when unset", () => {
      const adapter = makeAdapter();

      expect(adapter.getLogDir()).toBe(DEFAULT_FORGE_CONFIG.logDir);
      expect(adapter.getLogRetentionDays()).toBe(DEFAULT_FORGE_CONFIG.logRetentionDays);
    });
  });

  describe("display accessors", () => {
    it("returns the configured display values when populated", () => {
      const adapter = makeAdapter({
        display: {
          maxAgentEvents: 50,
          maxPreconnectBuffer: 25,
          maxOverlayHeight: "45%",
        },
      });

      expect(adapter.getDisplayMaxAgentEvents()).toBe(50);
      expect(adapter.getDisplayMaxPreconnectBuffer()).toBe(25);
      expect(adapter.getDisplayMaxOverlayHeight()).toBe("45%");
    });

    it("falls back to canonical defaults for an empty config", () => {
      const adapter = makeAdapter();

      expect(adapter.getDisplayMaxAgentEvents()).toBe(DEFAULT_FORGE_CONFIG.display.maxAgentEvents);
      expect(adapter.getDisplayMaxPreconnectBuffer()).toBe(
        DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer,
      );
      expect(adapter.getDisplayMaxOverlayHeight()).toBe(
        String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight),
      );
    });

    it("applies per-field defaults to a partial display block", () => {
      const adapter = makeAdapter({ display: { maxAgentEvents: 300 } });

      expect(adapter.getDisplayMaxAgentEvents()).toBe(300);
      expect(adapter.getDisplayMaxPreconnectBuffer()).toBe(
        DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer,
      );
    });

    it("coerces a numeric maxOverlayHeight to a string", () => {
      const adapter = makeAdapter({ display: { maxOverlayHeight: 40 } });

      expect(adapter.getDisplayMaxOverlayHeight()).toBe("40");
    });

    it("defaults maxOverlayHeight to the canonical default when unset", () => {
      const adapter = makeAdapter({ display: {} });

      expect(adapter.getDisplayMaxOverlayHeight()).toBe(
        String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight),
      );
    });
  });

  describe("getHideThinkingBlock", () => {
    it("returns false when no pi settings files exist", () => {
      const adapter = makeAdapter();

      expect(adapter.getHideThinkingBlock()).toBe(false);
    });

    it("returns true when the global settings file hides thinking blocks", async () => {
      await writeSettings(globalSettingsPath, { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("resolves the global settings dir from PI_CODING_AGENT_DIR", async () => {
      const customAgentDir = join(home, "custom-agent");
      vi.stubEnv("PI_CODING_AGENT_DIR", customAgentDir);
      await writeSettings(join(customAgentDir, "settings.json"), { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("tilde-expands PI_CODING_AGENT_DIR", async () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", "~/custom-agent");
      await writeSettings(join(home, "custom-agent", "settings.json"), {
        hideThinkingBlock: true,
      });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("treats a bare tilde PI_CODING_AGENT_DIR as the home dir", async () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", "~");
      await writeSettings(join(home, "settings.json"), { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("returns true when the project settings file hides thinking blocks", async () => {
      await writeSettings(projectSettingsPath, { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("prefers the project settings value over the global one", async () => {
      await writeSettings(globalSettingsPath, { hideThinkingBlock: true });
      await writeSettings(projectSettingsPath, { hideThinkingBlock: false });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(false);
    });

    it("falls back to the global value when the project file is missing", async () => {
      await writeSettings(globalSettingsPath, { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);
    });

    it("tolerates malformed settings files", async () => {
      await writeSettings(globalSettingsPath, "{ not valid json");
      await writeSettings(projectSettingsPath, "{ not valid json");

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(false);
    });

    it("tolerates non-boolean hideThinkingBlock values", async () => {
      await writeSettings(projectSettingsPath, { hideThinkingBlock: "yes" });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(false);
    });

    it("tolerates non-object settings files", async () => {
      await writeSettings(projectSettingsPath, "[1, 2, 3]");

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(false);
    });

    it("re-reads settings fresh on every call", async () => {
      await writeSettings(projectSettingsPath, { hideThinkingBlock: true });

      const adapter = makeAdapter();
      expect(adapter.getHideThinkingBlock()).toBe(true);

      // Toggle on disk - the next call must observe it (no caching).
      await writeSettings(projectSettingsPath, { hideThinkingBlock: false });
      expect(adapter.getHideThinkingBlock()).toBe(false);
    });
  });

  describe("snapshot semantics", () => {
    it("captures the config passed at construction, per construction", () => {
      // The adapter snapshots its config object at construction (mirroring
      // the plain resolved config): a config reload that swaps the object
      // only affects adapters constructed afterwards.
      const stale = makeAdapter({ logDir: "logs-a" });
      const fresh = makeAdapter({ logDir: "logs-b" });

      expect(stale.getLogDir()).toBe("logs-a");
      expect(fresh.getLogDir()).toBe("logs-b");
    });

    it("reads project settings from the constructor cwd", async () => {
      // The project settings live under the cwd passed to the adapter; the
      // resolution must not depend on the process working directory.
      await writeSettings(projectSettingsPath, { hideThinkingBlock: true });

      expect(makeAdapter().getHideThinkingBlock()).toBe(true);
      expect(makeAdapter({}, join(tempRoot, "elsewhere")).getHideThinkingBlock()).toBe(false);
    });
  });
});

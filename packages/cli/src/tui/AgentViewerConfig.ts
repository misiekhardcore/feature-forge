import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ForgeConfigData } from "@feature-forge/core";
import { DEFAULT_FORGE_CONFIG } from "@feature-forge/core";

import type { AgentViewerConfigSource } from "./api";

/**
 * CLI-side adapter implementing the method-shaped viewer config contract
 * from a plain, resolved forge config object.
 *
 * The viewer (showAgentViewer / AgentViewerOverlay) consumes configuration
 * through accessor methods; the resolved forge config is a plain frozen
 * data object. This adapter bridges the two, applying the same defaults the
 * legacy ForgeConfig class applied.
 *
 * The resolved config is captured once at construction: accessors are
 * stateless reads over that snapshot, so a config reload that swaps the
 * object takes effect on the next adapter construction (each construction
 * re-snapshots the current config). The one exception is
 * {@link getHideThinkingBlock}, which re-reads pi's settings files from
 * disk on every call.
 */
export class AgentViewerConfig implements AgentViewerConfigSource {
  private readonly config: Readonly<ForgeConfigData>;
  /** Project root used to locate the `<cwd>/.pi/settings.json` file. */
  private readonly cwd: string;

  constructor(config: Readonly<ForgeConfigData>, cwd: string = process.cwd()) {
    this.config = config;
    this.cwd = cwd;
  }

  /** Return the directory for log files. Defaults to `.forge/logs`. */
  getLogDir(): string {
    return this.config.logDir ?? DEFAULT_FORGE_CONFIG.logDir;
  }

  /** Return the configured log retention window in days. Defaults to 7. */
  getLogRetentionDays(): number {
    return this.config.logRetentionDays ?? DEFAULT_FORGE_CONFIG.logRetentionDays;
  }

  /**
   * Return the maximum events kept in memory per agent (sliding window FIFO).
   * Defaults to 200.
   *
   * The canonical defaults JSON always populates the display block; the `!`
   * restates that invariant for the schema-optional field types.
   */
  getDisplayMaxAgentEvents(): number {
    return this.config.display?.maxAgentEvents ?? DEFAULT_FORGE_CONFIG.display.maxAgentEvents!;
  }

  /**
   * Return the maximum events buffered before connect() is called (burst
   * protection). Defaults to 2000.
   */
  getDisplayMaxPreconnectBuffer(): number {
    return (
      this.config.display?.maxPreconnectBuffer ?? DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer!
    );
  }

  /**
   * Return the overlay height as a string - either a pixel count (e.g. `"30"`)
   * or a percentage (e.g. `"85%"`). Defaults to `"85%"`.
   */
  getDisplayMaxOverlayHeight(): string {
    const h = this.config.display?.maxOverlayHeight;
    if (h === undefined) return String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight);
    return typeof h === "number" ? String(h) : h;
  }

  /**
   * Whether pi's thinking blocks should be collapsed to the "Thinking..."
   * label instead of rendering the full reasoning text.
   *
   * Reads pi's settings.json files fresh on every call - pi exposes no
   * settings-change event, so the Ctrl+T toggle takes effect on the next
   * render. Resolution mirrors pi's SettingsManager: the global settings
   * file (agent dir from `$PI_CODING_AGENT_DIR`, tilde-expanded, else
   * `~/.pi/agent`) is merged with the project settings file
   * (`<cwd>/.pi/settings.json`), the project value winning. Missing or
   * malformed files are ignored.
   *
   * Defaults to `false` when unset.
   */
  getHideThinkingBlock(): boolean {
    const globalSettings = this.readPiSettings(path.join(this.getPiAgentDir(), "settings.json"));
    const projectSettings = this.readPiSettings(path.join(this.cwd, ".pi", "settings.json"));
    const hideThinkingBlock = projectSettings.hideThinkingBlock ?? globalSettings.hideThinkingBlock;
    return typeof hideThinkingBlock === "boolean" ? hideThinkingBlock : false;
  }

  /**
   * Resolve pi's agent config directory, mirroring pi's `getAgentDir()`:
   * `$PI_CODING_AGENT_DIR` when set (tilde-expanded), else `~/.pi/agent`.
   */
  private getPiAgentDir(): string {
    const envDir = process.env.PI_CODING_AGENT_DIR;
    if (envDir) {
      if (envDir === "~") return os.homedir();
      if (envDir.startsWith("~/")) return path.join(os.homedir(), envDir.slice(2));
      return envDir;
    }
    return path.join(os.homedir(), ".pi", "agent");
  }

  /**
   * Read a pi settings.json file, tolerating missing or malformed files
   * (both treated as empty). Non-object JSON shapes are ignored too.
   */
  private readPiSettings(settingsPath: string): Record<string, unknown> {
    try {
      const raw = fs.readFileSync(settingsPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

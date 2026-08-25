/**
 * Singleton configuration holder for the Feature Forge CLI.
 *
 * Loads configuration from disk on first access via {@link ConfigLoader.forRoot},
 * caches the frozen result, and provides a mechanism to reload on SIGHUP.
 *
 * Usage:
 * ```ts
 * const forgeConfig = await ForgeConfig.create();
 * const config = forgeConfig.getConfig();
 * ```
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { deepFreeze } from "../helpers";
import { ConfigError } from "./ConfigError";
import { ConfigLoader } from "./ConfigLoader";
import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import type {
  DevConfig,
  DisplayConfig,
  ForgeConfig as ForgeConfigType,
  SpecDirectories,
} from "./ForgeConfigSchema";
import { LogLevel } from "./ForgeConfigSchema";

/**
 * Singleton that owns the active, frozen configuration for the process.
 *
 * - {@link create} loads config on first call and caches the instance.
 * - {@link reload} replaces the frozen config from disk (called on SIGHUP).
 * - {@link destroy} tears down the singleton for testing.
 */
export class ForgeConfig {
  private static _instance: ForgeConfig | null = null;
  private static _config: Readonly<ForgeConfigType> | null = null;

  /** Registered SIGHUP handler reference, used for cleanup in destroy(). */
  private static signalHandler: (() => void) | null = null;

  /** CWD to use on reload when no explicit path is given. */
  private static cwd: string | undefined;

  private constructor() {
    // Enforce singleton — use ForgeConfig.create()
  }

  /**
   * Create (or retrieve) the singleton ForgeConfig instance.
   *
   * On first call, loads configuration via {@link ConfigLoader.forRoot}
   * and installs a SIGHUP listener that triggers {@link reload}.
   *
   * @param params.cwd — Directory to search for the config file
   *   (defaults to `process.cwd()`).
   * @returns The singleton ForgeConfig instance.
   */
  static async create(params: { cwd?: string } = {}): Promise<ForgeConfig> {
    if (this._instance && this._config) {
      return this._instance;
    }

    this.cwd = params.cwd;
    const loader = new ConfigLoader();
    // Deep-freeze: Object.freeze alone would leave nested structures
    // (display, dev, worktreeSymlinks, ...) mutable by reference holders.
    this._config = deepFreeze(await loader.forRoot(params));
    this._instance = new ForgeConfig();

    // Install SIGHUP handler only once
    if (typeof process !== "undefined" && !this.signalHandler) {
      this.signalHandler = () => {
        void ForgeConfig.reload();
      };
      process.on("SIGHUP", this.signalHandler);
    }

    return this._instance;
  }

  /**
   * Return the frozen configuration.
   *
   * @throws {@link ConfigError} if {@link create} has not been called yet.
   */
  getConfig(): Readonly<ForgeConfigType> {
    if (!ForgeConfig._config) {
      throw new ConfigError("ForgeConfig not initialized. Call ForgeConfig.create() first.");
    }
    return ForgeConfig._config;
  }

  /**
   * Reload configuration from disk.
   *
   * Reads the config file again and replaces the frozen config in-place.
   * Called automatically on SIGHUP.
   *
   * @param params.cwd — Directory to search for the config file
   *   (defaults to the cwd used during {@link create}).
   */
  static async reload(params: { cwd?: string } = {}): Promise<void> {
    const loader = new ConfigLoader();
    const resolvedCwd = params.cwd ?? this.cwd;
    this._config = deepFreeze(await loader.forRoot({ cwd: resolvedCwd }));
  }

  // ── Singleton access ────────────────────────────────────────────────

  /**
   * Get the singleton {@link ForgeConfig} instance.
   *
   * @throws Error when {@link create} has not been called yet
   *   (e.g., during early startup or in tests that need config).
   */
  static getInstance(): ForgeConfig {
    if (!this._instance) {
      throw new Error("Forge config not initialized");
    }
    return ForgeConfig._instance!;
  }

  // ── Typed accessor methods ──────────────────────────────────────────

  // The frozen config is always fully populated: ConfigLoader resolves
  // every field against DEFAULT_FORGE_CONFIG before storing it (schema
  // Decode fills per-field defaults for present blocks). The `!`
  // assertions below restate that invariant for schema-optional fields
  // — there is no `?? default` fallback branch to cover.

  /**
   * Return the configured log level.
   *
   * Defaults to `LogLevel.Info` when config is loaded with defaults.
   */
  getLogLevel(): LogLevel {
    return this.getConfig().logLevel;
  }

  /**
   * Return the prefix for log filenames (e.g. agent id or "forge").
   *
   * Defaults to `"forge"`.
   */
  getLogPrefix(): string {
    return this.getConfig().logPrefix!;
  }

  /**
   * Return the directory for log files.
   *
   * Defaults to `.forge/logs` when config is loaded with defaults.
   */
  getLogDir(): string {
    return this.getConfig().logDir!;
  }

  /**
   * Return the additional relative paths to symlink into every agent worktree.
   *
   * Defaults to an empty array.
   */
  getWorktreeSymlinks(): readonly string[] {
    return this.getConfig().worktreeSymlinks!;
  }

  /**
   * Return the default timeout for agent task execution in milliseconds.
   *
   * Defaults to 3600000 (1 hour).
   */
  getTaskTimeoutMs(): number {
    return this.getConfig().taskTimeoutMs!;
  }

  /**
   * Return the maximum number of retry attempts when an agent's
   * `parseJson` output is missing a valid JSON block.
   *
   * Defaults to 2. Set to 0 to disable retries entirely.
   */
  getJsonRetryMaxAttempts(): number {
    return this.getConfig().jsonRetryMaxAttempts!;
  }

  /**
   * Return the configured log retention window in days.
   * Defaults to 7.
   */
  getLogRetentionDays(): number {
    return this.getConfig().logRetentionDays!;
  }

  /**
   * Return whether full payload data is included in debug log entries.
   * Defaults to false.
   */
  getLogPayloads(): boolean {
    return this.getConfig().logPayloads!;
  }

  /**
   * Return the configured spec directories (additional paths for flows
   * and agent specs).
   *
   * Defaults to `{ flows: [], agents: [] }` when config is loaded
   * with defaults.
   */
  getSpecDirectories(): SpecDirectories {
    return this.getConfig().specDirectories!;
  }

  /**
   * Return the configured additional flow directories.
   */
  getFlowDirectories(): string[] {
    const flows = this.getSpecDirectories().flows ?? [];
    return flows.map((dir) => path.resolve(ForgeConfig.cwd ?? process.cwd(), dir));
  }

  /**
   * Return the forge directory path, resolved to an absolute path.
   *
   * Resolves `~` prefixes and relative paths against the project root
   * (the cwd used during {@link create}).
   *
   * Defaults to `".forge"` when no forgeDir is configured.
   */
  getForgeDir(): string {
    const forgeDir = this.getConfig().forgeDir!;
    if (forgeDir.startsWith("~")) {
      return path.join(os.homedir(), forgeDir.slice(1));
    }
    return path.resolve(ForgeConfig.cwd ?? process.cwd(), forgeDir);
  }

  /**
   * Return the absolute path to the pi CLI used to spawn sub-agents.
   *
   * Defaults to `undefined` — the factory resolves the pi bundled with
   * feature-forge.
   */
  getPiCli(): string | undefined {
    return this.getConfig().piCli;
  }

  /**
   * Return the configured additional agent spec directories.
   */
  getAgentSpecDirectories(): string[] {
    const dirs = this.getSpecDirectories().agents ?? [];
    return dirs.map((dir) => path.resolve(ForgeConfig.cwd ?? process.cwd(), dir));
  }

  // ── Display configuration accessors ────────────────────────────────

  /**
   * Return the display configuration block.
   *
   * Returns a frozen object with all three fields populated from config
   * or defaults.
   */
  getDisplayConfig(): DisplayConfig {
    return this.getConfig().display ?? DEFAULT_FORGE_CONFIG.display;
  }

  /**
   * Return the maximum events kept in memory per agent (sliding window FIFO).
   *
   * Defaults to 200.
   */
  getDisplayMaxAgentEvents(): number {
    // maxAgentEvents carries a schema default (200), so Decode always
    // populates it for a present display block; the block-level fallback
    // in getDisplayConfig covers an absent block.
    return this.getDisplayConfig().maxAgentEvents!;
  }

  /**
   * Return the maximum events buffered before connect() is called (burst protection).
   *
   * Defaults to 2000.
   */
  getDisplayMaxPreconnectBuffer(): number {
    // Schema default (2000) — see getDisplayMaxAgentEvents.
    return this.getDisplayConfig().maxPreconnectBuffer!;
  }

  /**
   * Return the overlay height as a string — either a pixel count
   * (e.g. `"30"`) or a percentage (e.g. `"85%"`).
   *
   * Defaults to `"85%"`.
   */
  getDisplayMaxOverlayHeight(): string {
    const h = this.getDisplayConfig().maxOverlayHeight;
    if (h === undefined) return String(DEFAULT_FORGE_CONFIG.display.maxOverlayHeight);
    return typeof h === "number" ? String(h) : h;
  }

  /**
   * Return the development configuration block.
   */
  getDevConfig(): DevConfig {
    return this.getConfig().dev ?? DEFAULT_FORGE_CONFIG.dev;
  }

  /**
   * Return whether development test commands are enabled.
   *
   * Defaults to `false`.
   */
  getDevEnabled(): boolean {
    // `enabled` carries a schema default (false), so Decode always
    // populates it for a present dev block; the block-level fallback
    // in getDevConfig covers an absent block.
    return this.getDevConfig().enabled!;
  }

  /**
   * Return whether pi's thinking blocks should be collapsed to the
   * "Thinking..." label in the agent overlay.
   *
   * Reads pi's settings.json files fresh on every call — pi exposes no
   * settings-change event, so the Ctrl+T toggle takes effect on the next
   * read. Resolution mirrors pi's `SettingsManager`: the global settings
   * file (agent dir from `$PI_CODING_AGENT_DIR`, tilde-expanded, else
   * `~/.pi/agent`) is merged with the project settings file
   * (`<cwd>/.pi/settings.json`), the project value winning. Missing or
   * malformed files are ignored.
   *
   * Defaults to `false` when unset.
   */
  getHideThinkingBlock(): boolean {
    const globalSettings = ForgeConfig.readPiSettings(
      path.join(ForgeConfig.getPiAgentDir(), "settings.json"),
    );
    const projectSettings = ForgeConfig.readPiSettings(
      path.join(ForgeConfig.cwd ?? process.cwd(), ".pi", "settings.json"),
    );
    const hideThinkingBlock = projectSettings.hideThinkingBlock ?? globalSettings.hideThinkingBlock;
    return typeof hideThinkingBlock === "boolean" ? hideThinkingBlock : false;
  }

  // ── Pi settings helpers ────────────────────────────────────────────

  /**
   * Resolve pi's agent config directory, mirroring pi's `getAgentDir()`:
   * `$PI_CODING_AGENT_DIR` when set (tilde-expanded), else `~/.pi/agent`.
   */
  private static getPiAgentDir(): string {
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
  private static readPiSettings(settingsPath: string): Record<string, unknown> {
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

  /**
   * Destroy the singleton instance and remove the SIGHUP listener.
   *
   * Primarily useful in tests to reset state between cases.
   */
  static destroy(): void {
    if (this.signalHandler && typeof process !== "undefined") {
      process.off("SIGHUP", this.signalHandler);
    }
    this._instance = null;
    this._config = null;
    this.signalHandler = null;
    this.cwd = undefined;
  }
}

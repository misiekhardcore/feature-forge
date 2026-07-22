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

import * as path from "node:path";

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
    this._config = Object.freeze(await loader.forRoot(params));
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
    this._config = Object.freeze(await loader.forRoot({ cwd: resolvedCwd }));
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
    return this.getConfig().logPrefix ?? DEFAULT_FORGE_CONFIG.logPrefix;
  }

  /**
   * Return the directory for log files.
   *
   * Defaults to `.forge/logs` when config is loaded with defaults.
   */
  getLogDir(): string {
    return this.getConfig().logDir ?? DEFAULT_FORGE_CONFIG.logDir;
  }

  /**
   * Return the additional relative paths to symlink into every agent worktree.
   *
   * Defaults to an empty array.
   */
  getWorktreeSymlinks(): readonly string[] {
    return this.getConfig().worktreeSymlinks ?? [];
  }

  /**
   * Return the default timeout for agent task execution in milliseconds.
   *
   * Defaults to 3600000 (1 hour).
   */
  getTaskTimeoutMs(): number {
    return this.getConfig().taskTimeoutMs ?? DEFAULT_FORGE_CONFIG.taskTimeoutMs;
  }

  /**
   * Return the configured spec directories (additional paths for flows
   * and agent specs).
   *
   * Defaults to `{ flows: [], agents: [] }` when config is loaded
   * with defaults.
   */
  getSpecDirectories(): SpecDirectories {
    return this.getConfig().specDirectories ?? { flows: [], agents: [] };
  }

  /**
   * Return the configured additional flow directories.
   */
  getFlowDirectories(): string[] {
    const flows = this.getSpecDirectories().flows ?? [];
    return flows.map((dir) => path.resolve(ForgeConfig.cwd ?? process.cwd(), dir));
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
    return this.getDisplayConfig().maxAgentEvents ?? DEFAULT_FORGE_CONFIG.display.maxAgentEvents!;
  }

  /**
   * Return the maximum events buffered before connect() is called (burst protection).
   *
   * Defaults to 2000.
   */
  getDisplayMaxPreconnectBuffer(): number {
    return (
      this.getDisplayConfig().maxPreconnectBuffer ??
      DEFAULT_FORGE_CONFIG.display.maxPreconnectBuffer!
    );
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
    return this.getDevConfig().enabled ?? DEFAULT_FORGE_CONFIG.dev.enabled!;
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

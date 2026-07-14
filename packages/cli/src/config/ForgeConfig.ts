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
import type {
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
   * @throws {@link ConfigError} if {@link create} has not been called yet.
   */
  static get instance(): ForgeConfig {
    return ForgeConfig.getInstance()!;
  }

  /**
   * Get the singleton {@link ForgeConfig} instance, or `undefined`
   * if not yet initialized.
   *
   * Returns `undefined` when {@link create} has not been called yet
   * (e.g., during early startup or in tests that don't need config).
   */
  static getInstance(): ForgeConfig | undefined {
    return ForgeConfig._instance ?? undefined;
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
   * Return the directory for log files.
   *
   * Defaults to `.forge/logs` when config is loaded with defaults.
   */
  getLogDir(): string {
    return this.getConfig().logDir ?? ".forge/logs";
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
    return this.getConfig().taskTimeoutMs ?? 60 * 60 * 1000;
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
    return (
      this.getConfig().display ?? {
        maxRawLength: 500,
        maxAgentEvents: 200,
        maxPreconnectBuffer: 2000,
      }
    );
  }

  /**
   * Return the maximum characters of raw agent output to display per entry.
   *
   * Defaults to 500.
   */
  getDisplayMaxRawLength(): number {
    return this.getDisplayConfig().maxRawLength ?? 500;
  }

  /**
   * Return the maximum events kept in memory per agent (sliding window FIFO).
   *
   * Defaults to 200.
   */
  getDisplayMaxAgentEvents(): number {
    return this.getDisplayConfig().maxAgentEvents ?? 200;
  }

  /**
   * Return the maximum events buffered before connect() is called (burst protection).
   *
   * Defaults to 2000.
   */
  getDisplayMaxPreconnectBuffer(): number {
    return this.getDisplayConfig().maxPreconnectBuffer ?? 2000;
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

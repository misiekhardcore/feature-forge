/**
 * Configuration file loader for the Feature Forge CLI.
 *
 * Loads and validates forge config from JSON or YAML files, merging
 * with defaults. Supports auto-discovery in a directory or loading
 * from a specific file path.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { Type } from "typebox";
import { Value } from "typebox/value";
import { parse as parseYaml } from "yaml";

import { InvalidConfigError, MissingConfigFileError } from "./ConfigError";
import { resolveConfig } from "./ForgeConfigDefaults";
import type { AgentConfig, ForgeConfig } from "./ForgeConfigSchema";
import { ForgeConfigSchema, LogLevel } from "./ForgeConfigSchema";

/**
 * JSON-native shape produced by {@link Value.Decode} before conversion
 * to {@link ForgeConfig} (where `agents` becomes a `ReadonlyMap`).
 */
type DecodedForgeConfig = Type.Static<typeof ForgeConfigSchema>;

/**
 * Options for configuring the {@link ConfigLoader} instance.
 */
export interface ConfigLoaderOptions {
  /**
   * Base name of the config file to search for (default: `"forge.config"`).
   * Extensions from {@link extensions} are appended during discovery.
   */
  readonly configFileName?: string;

  /**
   * File extensions to try during auto-discovery, in order (default:
   * `[".json", ".yaml", ".yml"]`). The first existing file is loaded.
   */
  readonly extensions?: readonly string[];
}

/**
 * Loads, validates, and resolves Feature Forge configuration files.
 *
 * Usage:
 * ```ts
 * const loader = new ConfigLoader();
 * const config = await loader.load({ cwd: "/path/to/project" });
 * ```
 *
 * When `loadFromFile` is called, the file must exist and contain valid
 * JSON or YAML that conforms to {@link ForgeConfigSchema}. When `load`
 * is called (auto-discovery), it searches for the config file in the
 * given directory; if none is found, the default configuration is returned.
 */
export class ConfigLoader {
  private readonly configFileName: string;
  private readonly extensions: readonly string[];

  constructor(params: ConfigLoaderOptions = {}) {
    this.configFileName = params.configFileName ?? "forge.config";
    this.extensions = params.extensions ?? [".json", ".yaml", ".yml"];
  }

  /**
   * Load a configuration file from an explicit file path.
   *
   * @param filePath — Absolute or relative path to the config file.
   * @returns A fully resolved {@link ForgeConfig}.
   * @throws {@link MissingConfigError} if the file does not exist.
   * @throws {@link InvalidConfigError} if the file is not valid JSON/YAML
   *   or fails schema validation.
   */
  async loadFromFile(filePath: string): Promise<ForgeConfig> {
    const ext = path.extname(filePath).toLowerCase();

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new MissingConfigFileError(filePath, error instanceof Error ? error : undefined);
    }

    const parsed = await this.parseContent(content, ext, filePath);

    if (!Value.Check(ForgeConfigSchema, parsed)) {
      const errors = [...Value.Errors(ForgeConfigSchema, parsed)];
      const detail = errors.map((e) => `  ${e.instancePath}: ${e.message}`).join("\n");
      throw new InvalidConfigError(
        filePath,
        "a valid forge config",
        parsed,
        new Error(`Schema validation failed:\n${detail}`),
      );
    }

    const decoded = Value.Decode(ForgeConfigSchema, parsed);

    // Merge env var overlay — env vars take priority over config file
    const envOverlay = this.resolveForgeEnvOverlay();
    const merged = { ...decoded, ...envOverlay };

    return this.toResolvedConfig(merged);
  }

  /**
   * Auto-discover and load a configuration file from a directory.
   *
   * Searches for the config file by trying each registered extension
   * in order within the specified directory. Returns the default
   * configuration if no file is found.
   *
   * @param params.cwd — Directory to search in (defaults to `process.cwd()`).
   * @returns A fully resolved {@link ForgeConfig}.
   */
  async load(params: { cwd?: string } = {}): Promise<ForgeConfig> {
    const searchDir = params.cwd ?? process.cwd();

    for (const ext of this.extensions) {
      const filePath = path.join(searchDir, `${this.configFileName}${ext}`);
      try {
        await fs.access(filePath);
        return this.loadFromFile(filePath);
      } catch {
        // File not accessible — try next extension
      }
    }

    // No config file found — return defaults (with env var overlay)
    return resolveConfig(this.resolveForgeEnvOverlay());
  }

  /**
   * Parse file content based on its extension.
   */
  private async parseContent(content: string, ext: string, filePath: string): Promise<unknown> {
    try {
      if (ext === ".yaml" || ext === ".yml") {
        return parseYaml(content);
      }
      // Default to JSON
      return JSON.parse(content) as unknown;
    } catch (error) {
      const expected = ext === ".yaml" || ext === ".yml" ? "valid YAML" : "valid JSON";
      throw new InvalidConfigError(
        filePath,
        expected,
        content.length > 200 ? `${content.slice(0, 200)}...` : content,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Load the root configuration file with two-location lookup.
   *
   * Lookup order:
   * 1. `.forge/config.json` (project-level config)
   *    - If it contains `forgeDir` pointing elsewhere (e.g. `~/.forge`),
   *      resolve the real config from `<forgeDir>/config.json` and merge
   *      any other keys from the project config as overrides on top.
   *    - If `forgeDir` is `.forge` or absent, this IS the real config.
   * 2. `forge.config.json` (repo-root config, legacy location)
   * 3. `~/.forge/config.json` (global forge, no project config)
   * 4. Defaults (no config file found)
   *
   * @param params.cwd — Directory to search in (defaults to `process.cwd()`).
   * @returns A fully resolved {@link ForgeConfig}.
   * @throws {@link InvalidConfigError} if the file exists but fails validation.
   */
  async forRoot(params: { cwd?: string } = {}): Promise<ForgeConfig> {
    const searchDir = params.cwd ?? process.cwd();

    // 1. Project-local .forge/config.json
    const projectConfigPath = path.join(searchDir, ".forge", "config.json");
    const projectConfig = await this.readJsonFile(projectConfigPath);

    if (projectConfig !== null) {
      const record = projectConfig;
      const rawForgeDir = record.forgeDir;

      if (
        rawForgeDir !== undefined &&
        typeof rawForgeDir === "string" &&
        rawForgeDir !== ".forge"
      ) {
        // Pointer file: forgeDir points elsewhere. Load the real config
        // from forgeDir and merge project-local overrides on top.
        const resolvedForgeDir = this.resolveForgeDir(rawForgeDir);
        const baseConfigPath = path.join(resolvedForgeDir, "config.json");
        const baseConfig = await this.readJsonFile(baseConfigPath);

        if (baseConfig === null) {
          throw new MissingConfigFileError(baseConfigPath);
        }

        // Build overrides from project config, stripping forgeDir
        const { forgeDir: _stripped, ...overrides } = record;
        const overridesResolved = this.resolveEnvVars(overrides);

        // Merge: base config → project overrides → env vars
        const merged = {
          ...baseConfig,
          ...(overridesResolved as Record<string, unknown>),
          ...this.resolveForgeEnvOverlay(),
          // forgeDir stays in the merged result; it was set by the project pointer
          forgeDir: rawForgeDir,
        };

        return this.validateAndResolve(merged, projectConfigPath);
      }

      // forgeDir is ".forge" or absent — this IS the real config file.
      const envOverlay = this.resolveForgeEnvOverlay();
      return this.validateAndResolve(
        { ...(this.resolveEnvVars(record) as Record<string, unknown>), ...envOverlay },
        projectConfigPath,
      );
    }

    // 2. forge.config.json at repo root (project-local, legacy location)
    const rootConfigPath = path.join(searchDir, `${this.configFileName}.json`);
    const rootConfig = await this.readJsonFile(rootConfigPath);
    if (rootConfig !== null) {
      const envOverlay = this.resolveForgeEnvOverlay();
      return this.validateAndResolve(
        { ...(this.resolveEnvVars(rootConfig) as Record<string, unknown>), ...envOverlay },
        rootConfigPath,
      );
    }

    // 3. Global ~/.forge/config.json (no project config at all)
    const globalConfigPath = path.join(os.homedir(), ".forge", "config.json");
    const globalConfig = await this.readJsonFile(globalConfigPath);
    if (globalConfig !== null) {
      const envOverlay = this.resolveForgeEnvOverlay();
      return this.validateAndResolve(
        { ...(this.resolveEnvVars(globalConfig) as Record<string, unknown>), ...envOverlay },
        globalConfigPath,
      );
    }

    // 4. Defaults
    return resolveConfig(this.resolveForgeEnvOverlay());
  }

  /**
   * Resolve a forgeDir value to an absolute path.
   *
   * Handles `~` prefix (home directory) and relative paths
   * (resolved against `process.cwd()`).
   */
  private resolveForgeDir(forgeDir: string): string {
    if (forgeDir.startsWith("~")) {
      return path.join(os.homedir(), forgeDir.slice(1));
    }
    return path.resolve(process.cwd(), forgeDir);
  }

  /**
   * Read and parse a JSON file, returning `null` on any error.
   *
   * File-not-found, permission denied, and parse errors all return null
   * silently — callers decide whether missing config is an error.
   */
  private async readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch (parseError) {
        console.warn(
          `[feature-forge] Invalid JSON in ${filePath}: ${(parseError as Error).message}. ` +
            "Falling back to default configuration.",
        );
        return null;
      }
    } catch {
      // File not found or permission denied — no warning needed
      return null;
    }
  }

  /**
   * Validate a merged config object against the schema and resolve it.
   *
   * @param merged — Raw config object (post-merge, pre-validation).
   * @param sourcePath — Path used only for error messages.
   * @returns A fully resolved {@link ForgeConfig}.
   * @throws {@link InvalidConfigError} if validation fails.
   */
  private validateAndResolve(merged: unknown, sourcePath: string): ForgeConfig {
    if (!Value.Check(ForgeConfigSchema, merged)) {
      const errors = [...Value.Errors(ForgeConfigSchema, merged)];
      const detail = errors.map((e) => `  ${e.instancePath}: ${e.message}`).join("\n");
      throw new InvalidConfigError(
        sourcePath,
        "a valid forge config",
        merged,
        new Error(`Schema validation failed:\n${detail}`),
      );
    }

    const decoded = Value.Decode(ForgeConfigSchema, merged);
    return this.toResolvedConfig(decoded);
  }

  /**
   * Recursively walk a value and replace `${ENV_VAR_NAME}` patterns in
   * string values with the corresponding environment variable value.
   *
   * Operates on a deep clone — the original input is never modified.
   * Non-string values (numbers, booleans, null, arrays) are passed through
   * unchanged; arrays are recursed into element-by-element.
   *
   * @param value — The value to resolve (typically a parsed JSON object).
   * @returns A deep clone with all env var references resolved.
   */
  resolveEnvVars(value: unknown): unknown {
    if (typeof value === "string") {
      return value.replace(/\$\{([^}]+)\}/g, (_: string, name: string): string => {
        const envValue: string | undefined = process.env[name];
        return envValue ?? "";
      });
    }

    if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        return value.map((item: unknown) => this.resolveEnvVars(item));
      }

      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.resolveEnvVars(val);
      }
      return result;
    }

    // Primitive — return as-is
    return value;
  }

  /**
   * Convert a flat record of dot-path keys to string values into a nested
   * object structure.
   *
   * Example:
   * ```ts
   * buildEnvOverlay({ "logging.level": "debug" })
   * // → { logging: { level: "debug" } }
   * ```
   *
   * @param flatMap — A record where each key is a dot-separated path and
   *   each value is the string to place at that path.
   * @returns A nested object built from the dot-path entries.
   */
  buildEnvOverlay(flatMap: Record<string, string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [dotPath, value] of Object.entries(flatMap)) {
      const parts = dotPath.split(".");
      let current = result;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
          current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
      }

      current[parts[parts.length - 1]] = value;
    }

    return result;
  }

  /**
   * Build a partial config overlay from known FORGE_* environment variables.
   *
   * Each known env var is read, type-coerced, and added to the overlay.
   * Invalid values (unparsable numbers, unknown log levels) are silently
   * skipped — the config system falls back to defaults.
   *
   * These are read at config-load time and merged into the resolved config
   * (taking priority over values from config files). Subprocesses inherit
   * the same env vars from the parent process and use them as fallbacks
   * when ForgeConfig is not initialized in the child.
   *
   * Current env vars (all one-to-one with ForgeConfigSchema fields):
   * - FORGE_TASK_TIMEOUT_MS → taskTimeoutMs (number, parsed)
   * - FORGE_LOG_LEVEL     → logLevel (string, validated against LogLevel enum)
   * - FORGE_LOG_DIR       → logDir (string, used as-is)
   * - FORGE_WORKTREE_SYMLINKS → worktreeSymlinks (comma-separated paths)
   * - FORGE_DEV           → dev.enabled (boolean, "1" or "true")
   * - FORGE_SPEC          → logPrefix (string, extracted from agent spec id)
   *
   * Internal plumbing (FORGE_PARENT_SOCKET) is handled directly
   * by the files that use it — it is transport-level, not a config value.
   */
  resolveForgeEnvOverlay(): Record<string, unknown> {
    const overlay: Record<string, unknown> = {};

    // Extract agent identity from FORGE_SPEC for log prefix.
    // In child processes, FORGE_SPEC contains the full agent spec as JSON
    // with a unique `id` field (e.g. "builder-a3f8c2").
    const forgeSpecRaw = process.env.FORGE_SPEC;
    if (forgeSpecRaw) {
      try {
        const spec = JSON.parse(forgeSpecRaw) as { id?: string };
        if (spec.id) {
          overlay.logPrefix = spec.id;
        }
      } catch {
        // Malformed FORGE_SPEC — ignore, logPrefix stays "forge".
      }
    }

    const timeoutMs = process.env.FORGE_TASK_TIMEOUT_MS;
    if (timeoutMs !== undefined) {
      const parsed = Number(timeoutMs);
      if (Number.isFinite(parsed) && parsed >= 1) {
        overlay.taskTimeoutMs = parsed;
      }
    }

    const logLevel = process.env.FORGE_LOG_LEVEL;
    if (logLevel !== undefined) {
      const validLevels = Object.values(LogLevel) as string[];
      if (validLevels.includes(logLevel)) {
        overlay.logLevel = logLevel;
      }
    }

    const logDir = process.env.FORGE_LOG_DIR;
    if (logDir !== undefined) {
      overlay.logDir = logDir;
    }

    const worktreeSymlinks = process.env.FORGE_WORKTREE_SYMLINKS;
    if (worktreeSymlinks !== undefined && worktreeSymlinks.length > 0) {
      overlay.worktreeSymlinks = worktreeSymlinks.split(",").map((s) => s.trim());
    }

    const devEnabled = process.env.FORGE_DEV;
    if (devEnabled !== undefined) {
      overlay.dev = { enabled: devEnabled === "1" || devEnabled.toLowerCase() === "true" };
    }

    return overlay;
  }

  /**
   * Convert a decoded (JSON-shaped) config into a fully resolved
   * {@link ForgeConfig}, converting the agents Record to a Map.
   *
   * {@link Value.Decode} returns JSON-native types (Record for the
   * `agents` field), but {@link ForgeConfig} requires a ReadonlyMap.
   */
  private toResolvedConfig(decoded: DecodedForgeConfig): ForgeConfig {
    const agents = new Map<string, AgentConfig>(
      decoded.agents ? Object.entries(decoded.agents) : [],
    );

    return resolveConfig({
      logLevel: decoded.logLevel,
      logPrefix: decoded.logPrefix,
      workspaceProvider: decoded.workspaceProvider,
      agents,
      defaultAgent: decoded.defaultAgent,
      logDir: decoded.logDir,
      logRetentionDays: decoded.logRetentionDays,
      logPayloads: decoded.logPayloads,
      worktreeSymlinks: decoded.worktreeSymlinks,
      taskTimeoutMs: decoded.taskTimeoutMs,
      jsonRetryMaxAttempts: decoded.jsonRetryMaxAttempts,
      specDirectories: decoded.specDirectories,
      models: decoded.models,
      defaultModel: decoded.defaultModel,
      display: decoded.display,
      dev: decoded.dev,
      forgeDir: decoded.forgeDir,
    });
  }
}

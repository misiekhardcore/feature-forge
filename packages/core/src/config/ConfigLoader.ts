/**
 * Configuration file loader for the Feature Forge CLI.
 *
 * Loads and validates forge config from JSON or YAML files, merging
 * with defaults. The production entry point is {@link ConfigLoader.forRoot}:
 * it loads the two fixed forge homes per ADR 0028. The single-file entry
 * points ({@link ConfigLoader.load}, {@link ConfigLoader.loadFromFile})
 * predate the fixed-homes cascade and survive for tests and callers that
 * need one explicit file - the extension never auto-discovers the legacy
 * repo-root `forge.config.json` location anymore.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Type } from "typebox";
import { Value } from "typebox/value";
import { parse as parseYaml } from "yaml";

import { logger } from "../logging/Logger";
import { InvalidConfigError, MissingConfigFileError } from "./ConfigError";
import { resolveConfig } from "./ForgeConfigDefaults";
import { ForgeConfigPaths } from "./ForgeConfigPaths";
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
 * Usage (production - the fixed-homes cascade, see ADR 0028):
 * ```ts
 * const loader = new ConfigLoader();
 * const config = await loader.forRoot({ cwd: "/path/to/project" });
 * ```
 *
 * `forRoot` layers the project `.forge/config.json` over the global
 * `~/.forge/config.json` over the packaged defaults. {@link load} and
 * {@link loadFromFile} are the legacy single-file entry points kept for
 * tests: `load` auto-discovers a repo-root `forge.config.json` - the
 * location ADR 0028 removed, so the extension never calls it - and
 * `loadFromFile` reads one explicit file. Use `forRoot` wherever the
 * extension loads config.
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
   * Legacy single-file entry point (predates the fixed-homes cascade):
   * production config loading goes through {@link forRoot}.
   *
   * @param filePath — Absolute or relative path to the config file.
   * @returns A fully resolved {@link ForgeConfig}.
   * @throws {@link MissingConfigFileError} if the file does not exist.
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
   * Legacy entry point: searches a single directory for a repo-root
   * `forge.config.json`-style file (the location ADR 0028 removed). The
   * extension loads config through {@link forRoot} only; this survives
   * for tests and callers needing the old single-file discovery.
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
   * Load the root configuration file with a fixed-home cascade.
   *
   * Layer order (nearer wins):
   * 1. `<cwd>/.forge/config.json` - project-level config.
   * 2. `~/.forge/config.json` - global config.
   * 3. Packaged defaults (no file involved).
   *
   * The project config merges onto the global config per top-level key:
   * keys set by the project file win; sections it omits fall back to the
   * global file. `${ENV_VAR}` references are resolved inside both files,
   * and the FORGE_* env overlay (see {@link resolveForgeEnvOverlay}) stays
   * top-most over the merged result. A missing layer is skipped; when
   * neither file exists, the defaults (plus the env overlay) are returned.
   *
   * The legacy repo-root `forge.config.json` location is ignored, and a
   * leftover legacy `forgeDir` pointer key in an old config file is a
   * no-op: it validates as an unknown key and is dropped when the merged
   * result is resolved - it is no longer followed to another config file
   * nor mapped onto any config field.
   *
   * @param params.cwd — Directory to search in (defaults to `process.cwd()`).
   * @returns A fully resolved {@link ForgeConfig}.
   * @throws {@link InvalidConfigError} if a config file exists but the
   *   merged result fails validation.
   */
  async forRoot(params: { cwd?: string } = {}): Promise<ForgeConfig> {
    const searchDir = params.cwd ?? process.cwd();

    // 1. Project layer: <cwd>/.forge/config.json (invalid JSON warns + skips).
    //    Composed with ForgeConfigPaths so the fixed-home rule (ADR 0028 D1)
    //    lives in one place.
    const projectConfigPath = path.join(
      ForgeConfigPaths.resolveProjectHome(searchDir),
      "config.json",
    );
    const projectConfig = await this.readJsonFile(projectConfigPath);

    // 2. Global layer: ~/.forge/config.json (invalid JSON warns + skips).
    const globalConfigPath = path.join(ForgeConfigPaths.resolveGlobalHome(), "config.json");
    const globalConfig = await this.readJsonFile(globalConfigPath);

    // 3. Neither file exists - defaults plus the env overlay.
    if (projectConfig === null && globalConfig === null) {
      return resolveConfig(this.resolveForgeEnvOverlay());
    }

    // 4. Merge per top-level key: project wins over global; sections the
    // project file omits fall back to the global file. ${ENV_VAR}
    // references are resolved inside both files before merging.
    const merged: Record<string, unknown> = {};
    if (globalConfig !== null) {
      Object.assign(merged, this.resolveEnvVars(globalConfig) as Record<string, unknown>);
    }
    if (projectConfig !== null) {
      Object.assign(merged, this.resolveEnvVars(projectConfig) as Record<string, unknown>);
    }

    // 5. FORGE_* env overlay stays top-most over the merged file config.
    // Validation failures are attributed to every contributing file: when
    // both layers exist the invalid key may come from either one, so the
    // error names the merged pair rather than only the nearer project file.
    const sourcePath =
      projectConfig !== null && globalConfig !== null
        ? `${projectConfigPath} merged with ${globalConfigPath}`
        : projectConfig !== null
          ? projectConfigPath
          : globalConfigPath;
    return this.validateAndResolve({ ...merged, ...this.resolveForgeEnvOverlay() }, sourcePath);
  }

  /**
   * Read and parse a JSON file, returning `null` on any error.
   *
   * File-not-found and permission errors return null silently - callers
   * decide whether missing config is an error. Parse errors return null
   * too but log a warning (naming the file) and skip the file.
   */
  private async readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      try {
        return JSON.parse(content) as Record<string, unknown>;
      } catch (parseError) {
        logger.warn(
          `[feature-forge] Invalid JSON in ${filePath}: ${(parseError as Error).message}. ` +
            `Skipping the invalid config file.`,
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
   * the same env vars from the parent process; each process applies them
   * during its own config load, so the child never depends on a parent-held
   * config snapshot.
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
      logMaxBytes: decoded.logMaxBytes,
      logMaxFiles: decoded.logMaxFiles,
      logPayloads: decoded.logPayloads,
      worktreeSymlinks: decoded.worktreeSymlinks,
      taskTimeoutMs: decoded.taskTimeoutMs,
      jsonRetryMaxAttempts: decoded.jsonRetryMaxAttempts,
      specDirectories: decoded.specDirectories,
      models: decoded.models,
      defaultModel: decoded.defaultModel,
      display: decoded.display,
      dev: decoded.dev,
    });
  }
}

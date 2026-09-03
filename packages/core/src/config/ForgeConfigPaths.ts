/**
 * Derived absolute-path resolution over a resolved forge config.
 *
 * The resolved {@link ForgeConfig} stores path values relative to the
 * project root (e.g. `forgeDir: ".forge"`, spec-directory entries).
 * These helpers turn them into absolute filesystem paths for consumers
 * that need real locations (worktree provisioning, skill resolution).
 *
 * No instance state and no process-global reads: the config object and
 * the project cwd to resolve against are passed explicitly, so the same
 * config can be resolved against different roots and tests need no
 * singleton bootstrap.
 */

import * as os from "node:os";
import * as path from "node:path";

import { DEFAULT_FORGE_CONFIG } from "./ForgeConfigDefaults";
import type { ForgeConfig } from "./ForgeConfigSchema";

/**
 * Derived path helpers over a resolved {@link ForgeConfig}.
 *
 * Mirrors the derived-path accessors of the legacy ForgeConfig singleton
 * (`getForgeDir`, `getFlowDirectories`, `getAgentSpecDirectories`):
 * tilde prefixes expand against `os.homedir()`, all other relative paths
 * resolve against the explicitly passed project cwd.
 */
export class ForgeConfigPaths {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Resolve the forge directory to an absolute path.
   *
   * Any leading `~` expands against the home directory: bare `~`, `~/...`
   * and `~user/...` all become `<homedir>/<rest-after-tilde>` (parity
   * with the legacy accessor). A `~user/...` value is NOT resolved to
   * that user's actual home - only the tilde is stripped - so treat it
   * as a home-relative path unless the resolved root is the current user.
   *
   * @param config - Fully resolved forge config (see {@link ForgeConfigLoader.load}).
   * @param cwd - Project root to resolve relative paths against.
   * @returns Absolute forge directory path.
   */
  static resolveForgeDir(config: Readonly<ForgeConfig>, cwd: string): string {
    // Fallback covers hand-built partial configs; resolved configs always
    // carry forgeDir (resolveConfig fills it from the canonical defaults).
    const forgeDir = config.forgeDir ?? DEFAULT_FORGE_CONFIG.forgeDir!;
    if (forgeDir.startsWith("~")) {
      return path.join(os.homedir(), forgeDir.slice(1));
    }
    return path.resolve(cwd, forgeDir);
  }

  /**
   * Resolve the additional flow directories to absolute paths.
   *
   * @param config - Fully resolved forge config (see {@link ForgeConfigLoader.load}).
   * @param cwd - Project root to resolve relative paths against.
   * @returns Absolute paths, in configured order; empty when unconfigured.
   */
  static resolveFlowDirectories(config: Readonly<ForgeConfig>, cwd: string): string[] {
    const flows = config.specDirectories?.flows ?? [];
    return flows.map((dir) => path.resolve(cwd, dir));
  }

  /**
   * Resolve the additional agent-spec directories to absolute paths.
   *
   * @param config - Fully resolved forge config (see {@link ForgeConfigLoader.load}).
   * @param cwd - Project root to resolve relative paths against.
   * @returns Absolute paths, in configured order; empty when unconfigured.
   */
  static resolveAgentSpecDirectories(config: Readonly<ForgeConfig>, cwd: string): string[] {
    const agents = config.specDirectories?.agents ?? [];
    return agents.map((dir) => path.resolve(cwd, dir));
  }
}

/**
 * Stateless loading entry point for the root forge config.
 *
 * Loads the config via {@link ConfigLoader.forRoot} and deep-freezes the
 * result so every consumer receives an immutable, fully-resolved
 * {@link ForgeConfig}. Each call constructs a fresh {@link ConfigLoader}
 * and re-reads the config files - no singleton state, no SIGHUP handler,
 * no cross-call caching. Reload semantics are the caller's to control.
 */

import { deepFreeze } from "../helpers";
import { ConfigLoader } from "./ConfigLoader";
import type { ForgeConfig } from "./ForgeConfigSchema";

/**
 * Static loader for the root forge config.
 *
 * Usage:
 * ```ts
 * const config = await ForgeConfigLoader.load({ cwd: "/path/to/project" });
 * ```
 */
export class ForgeConfigLoader {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Load the root forge config and return it deep-frozen.
   *
   * @param params.cwd - Directory to search for the config file
   *   (defaults to `process.cwd()`).
   * @returns A fully resolved, deeply frozen {@link ForgeConfig}.
   */
  static async load(params: { cwd?: string } = {}): Promise<Readonly<ForgeConfig>> {
    return deepFreeze(await new ConfigLoader().forRoot(params));
  }
}

/**
 * Absolute-path resolution over the fixed forge homes and a resolved
 * forge config.
 *
 * The forge asset homes are FIXED - there is no configurable `forgeDir`
 * anymore:
 * - Project home: `<cwd>/.forge` (per-project assets + config).
 * - Global home: `~/.forge` (cross-project assets + config).
 * - Packaged home: the bundled flows/skills/agents assets shipped with the
 *   extension (an install-layout probe, resolved via the module location).
 *
 * The resolved {@link ForgeConfig} only stores relative path values for
 * the *additional* spec directories (`specDirectories` entries), which
 * these helpers turn into absolute filesystem paths for consumers that
 * need real locations (worktree provisioning, skill resolution).
 *
 * No instance state and no config-singleton reads: fixed homes derive from
 * the passed project cwd and `os.homedir()`, additional spec-directory
 * entries resolve against the project cwd passed explicitly, and the
 * packaged layout is probed from the module location - so the same config
 * can be resolved against different roots and tests need no singleton
 * bootstrap.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ForgeConfig } from "./ForgeConfigSchema";

/**
 * Derived path helpers over the fixed forge homes and a resolved
 * {@link ForgeConfig}.
 *
 * Mirrors the derived-path accessors of the legacy ForgeConfig singleton
 * (`getForgeDir`, `getFlowDirectories`, `getAgentSpecDirectories`):
 * project/global home helpers return the fixed `.forge` locations,
 * relative spec-directory entries resolve against the explicitly passed
 * project cwd, and the packaged install-layout helpers resolve the
 * bundled default assets shipped with the extension.
 */
export class ForgeConfigPaths {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /** Marker directories whose presence identifies a packaged assets root. */
  private static readonly PACKAGED_ASSET_MARKERS = ["flows", "skills", "agents"] as const;

  /**
   * Resolve the project forge home: `<cwd>/.forge`.
   *
   * The per-project forge directory is fixed - it is always the `.forge`
   * directory inside the project cwd, never a config-derived value.
   *
   * @param cwd - Project root the home lives in.
   * @returns Absolute path to `<cwd>/.forge`.
   */
  static resolveProjectHome(cwd: string): string {
    return path.join(cwd, ".forge");
  }

  /**
   * Resolve the global forge home: `~/.forge` (the current user's home).
   *
   * The cross-project forge directory is fixed - it is always the
   * `.forge` directory inside the current user's home directory, never a
   * config-derived value.
   *
   * @returns Absolute path to `<homedir>/.forge`.
   */
  static resolveGlobalHome(): string {
    return path.join(os.homedir(), ".forge");
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

  /**
   * Resolve the directory holding the bundled (packaged) default assets:
   * the `flows`, `skills` and `agents` directories shipped with the
   * extension.
   *
   * Mirrors the `resolveAssetsDir()` probe in forge-setup.js: the module's
   * own directory is the anchor, and candidate parents are probed for any
   * of the marker directories (`flows`, `skills`, `agents`). The first
   * candidate containing any marker wins.
   *
   * Layouts this resolves:
   * - Built bundle (`packages/cli/dist/index.js`): the module dir is
   *   `<cli>/dist`, which holds the copied `flows`/`skills`/`agents`
   *   marker dirs (tsup's onSuccess copies them there).
   * - Vitest from the core source (`packages/core/src/config`): the
   *   parent `packages/core/src` holds the markers.
   * - In-process boots of the cli source: `packages/cli/src` has no
   *   markers, so the core-source fallback probe below is needed.
   *
   * @returns The first candidate assets root found, or `undefined` when no
   *   candidate contains any of the marker directories.
   */
  private static resolvePackagedAssetsRoot(): string | undefined {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      moduleDir,
      path.resolve(moduleDir, ".."),
      path.resolve(moduleDir, "..", ".."),
      // Source-layout fallback: running un-bundled from the monorepo, the
      // marker dirs live in the core package one hop away.
      path.resolve(moduleDir, "..", "..", "core", "src"),
    ];
    for (const candidate of candidates) {
      if (
        this.PACKAGED_ASSET_MARKERS.some((marker) => fs.existsSync(path.join(candidate, marker)))
      ) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * Resolve the packaged default agent-spec directory.
   *
   * The built layout keeps the declarative specs at
   * `<assets>/agents/declarative-specs`; the core source layout keeps the
   * same files at `<assets>/agents/specifications/templates`. The first
   * existing location wins, with a bare `<assets>/agents` as the final
   * fallback (any `.md` spec files there still register).
   *
   * @returns The packaged agents directory, or `undefined` when no assets
   *   root resolved or none of the locations exist.
   */
  static resolvePackagedAgentsDir(): string | undefined {
    const root = this.resolvePackagedAssetsRoot();
    if (!root) {
      return undefined;
    }
    const declarativeSpecs = path.join(root, "agents", "declarative-specs");
    if (fs.existsSync(declarativeSpecs)) {
      return declarativeSpecs;
    }
    const templates = path.join(root, "agents", "specifications", "templates");
    if (fs.existsSync(templates)) {
      return templates;
    }
    const agents = path.join(root, "agents");
    return fs.existsSync(agents) ? agents : undefined;
  }

  /**
   * Resolve the packaged default flow directory (a directory whose
   * immediate subdirectories are flows, each with its own `flow.json`).
   *
   * The built layout copies the flow definitions straight under
   * `<assets>/flows`; the core source layout keeps the same definitions
   * under `<assets>/flows/definitions` (tsup's onSuccess copies exactly
   * that directory to `dist/flows`). The first candidate containing flow
   * directories wins, so both layouts resolve to a root `FlowRegistrar`
   * can discover directly.
   *
   * @returns The packaged flows directory, or `undefined` when no assets
   *   root resolved or no candidate holds flow directories.
   */
  static resolvePackagedFlowsDir(): string | undefined {
    const root = this.resolvePackagedAssetsRoot();
    if (!root) {
      return undefined;
    }
    const flowsRoot = path.join(root, "flows");
    for (const candidate of [flowsRoot, path.join(flowsRoot, "definitions")]) {
      if (this.containsFlowDirectories(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * Resolve the packaged default skills directory.
   *
   * Both layouts keep the bundled skills directly under
   * `<assets>/skills` (source: `packages/core/src/skills`, built:
   * `<cli>/dist/skills` - the tsup build copies the source dir verbatim).
   *
   * @returns The packaged skills directory, or `undefined` when no assets
   *   root resolved or the directory does not exist.
   */
  static resolvePackagedSkillsDir(): string | undefined {
    const root = this.resolvePackagedAssetsRoot();
    if (!root) {
      return undefined;
    }
    const skills = path.join(root, "skills");
    return fs.existsSync(skills) ? skills : undefined;
  }

  /**
   * Whether a directory directly contains at least one flow directory
   * (an immediate subdirectory carrying its own `flow.json`).
   *
   * Mirrors the flow discovery convention (a flows root holds one
   * directory per flow): a root that contains no flow directories (e.g.
   * the core source module dir, which keeps them under `definitions/`)
   * is not a usable packaged root.
   */
  private static containsFlowDirectories(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some(
      (entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "flow.json")),
    );
  }
}

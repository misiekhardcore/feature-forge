import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/shared";

import { bundledSkillDirectories } from "../agents/specifications/skill-resolver";

/**
 * Register a `resources_discover` handler that contributes the CLI package's
 * bundled default skills and the forge directory's `skills/` to the main
 * session's skill discovery.
 *
 * This makes default and user-scaffolded skills available to the in-session
 * orchestrator. The forge-dir skills directory is listed first, so a
 * user-scaffolded skill whose name collides with a bundled skill takes
 * priority; bundled skills serve as fallback for names not present in the
 * forge directory.
 */
export function activateForgeSkills(pi: ExtensionAPI): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    let forgeSkillsDir: string;
    try {
      forgeSkillsDir = path.join(ForgeConfig.getInstance().getForgeDir(), "skills");
    } catch {
      // ForgeConfig not initialized — fall back to .forge/skills
      forgeSkillsDir = path.resolve(".forge", "skills");
    }

    const skillPaths: string[] = [];
    for (const dir of [forgeSkillsDir, ...bundledSkillDirectories()]) {
      try {
        if (fs.existsSync(dir)) {
          skillPaths.push(dir);
        }
      } catch (error) {
        logger.warn("Failed to check skill directory", {
          path: dir,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return skillPaths.length > 0 ? { skillPaths } : {};
  });
}

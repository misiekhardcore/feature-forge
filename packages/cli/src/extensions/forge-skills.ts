import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/shared";

import { bundledSkillDirectories } from "../agents/specifications/skill-resolver";

/**
 * Register a `resources_discover` handler that contributes the CLI package's
 * bundled default skills and the project's `.forge/skills/` to the main
 * session's skill discovery.
 *
 * This makes default and project-local skills available to the in-session
 * orchestrator.
 */
export function activateForgeSkills(pi: ExtensionAPI): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    const skillPaths: string[] = [];
    for (const dir of [...bundledSkillDirectories(), path.resolve(".forge", "skills")]) {
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

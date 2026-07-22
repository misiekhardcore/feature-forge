import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/shared";

/**
 * Register a `resources_discover` handler that contributes `.forge/skills/`
 * to the main session's skill discovery.
 *
 * This makes project-local skills available to the in-session orchestrator.
 */
export function activateForgeSkills(pi: ExtensionAPI): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    const forgeSkillsDir = path.resolve(".forge", "skills");
    try {
      if (fs.existsSync(forgeSkillsDir)) {
        return { skillPaths: [forgeSkillsDir] };
      }
    } catch (error) {
      logger.warn("Failed to check .forge/skills directory", {
        path: forgeSkillsDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {};
  });
}

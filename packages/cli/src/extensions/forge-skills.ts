import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ForgeConfig } from "@feature-forge/shared";

/**
 * Register a `resources_discover` handler that contributes the forge
 * directory's `skills/` to the main session's skill discovery.
 *
 * Only the forge directory is contributed: `forge:init` scaffolds the bundled
 * default skills there, so the runtime never falls back to bundled package
 * paths (ADR-0015). Contributing both would produce skill-name collisions
 * between the scaffolded and bundled copies.
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

    if (!fs.existsSync(forgeSkillsDir)) {
      return {};
    }
    return { skillPaths: [forgeSkillsDir] };
  });
}

import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register a `resources_discover` handler that contributes the forge
 * directory's `skills/` to the main session's skill discovery.
 *
 * Only the forge directory is contributed: `forge:init` scaffolds the bundled
 * default skills there, so the runtime never falls back to bundled package
 * paths (ADR-0015). Contributing both would produce skill-name collisions
 * between the scaffolded and bundled copies.
 *
 * The forge directory is resolved by the caller (the composition root) and
 * threaded in explicitly — this module never reads the config singleton.
 */
export function activateForgeSkills(pi: ExtensionAPI, forgeDir: string): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    const forgeSkillsDir = path.join(forgeDir, "skills");

    if (!fs.existsSync(forgeSkillsDir)) {
      return {};
    }
    return { skillPaths: [forgeSkillsDir] };
  });
}

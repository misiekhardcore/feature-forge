import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

// ESM polyfill: __dirname is not available in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const execFileAsync = promisify(execFile);

export class ForgeInitCommand extends Command {
  readonly name = "forge:init";
  readonly description = "Initialize Feature Forge project scaffolding";

  handler = async (_args: string, ctx: ExtensionCommandContext) => {
    const setupScript = path.join(__dirname, "..", "scripts", "forge-setup.sh");

    const scaffoldConfig = await ctx.ui.confirm(
      "Forge: Init",
      "Scaffold .forge/config.json with defaults?",
    );
    const updateGitignore = await ctx.ui.confirm("Forge: Init", "Add forge entries to .gitignore?");

    const args = ["bash", setupScript];
    if (!scaffoldConfig) args.push("--no-config");
    if (!updateGitignore) args.push("--no-gitignore");
    args.push("--yes", "--cwd", process.cwd());

    try {
      await execFileAsync(args[0], args.slice(1));
      ctx.ui.notify("Feature Forge initialized successfully", "info");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      ctx.ui.notify(`Setup failed: ${message}`, "error");
    }
  };
}

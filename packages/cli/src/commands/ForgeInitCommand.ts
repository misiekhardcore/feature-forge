import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Command } from "@feature-forge/core/src/commands/Command";

// ESM polyfill: __dirname is not available in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const execFileAsync = promisify(execFile);

export class ForgeInitCommand extends Command {
  readonly name = "forge:init";
  readonly description = "Initialize Feature Forge project scaffolding";

  handler = async (_args: string, ctx: ExtensionCommandContext) => {
    const setupScript = path.join(__dirname, "..", "scripts", "forge-setup.js");

    const scope = await ctx.ui.select(
      "Forge: Init — where should agents, flows, and skills be stored?",
      [
        "project — .forge/ inside this project",
        "global — ~/.forge shared across projects (logs and worktrees stay project-local)",
      ],
    );

    if (!scope) {
      ctx.ui.notify("Forge init cancelled", "info");
      return;
    }

    const useGlobal = scope.startsWith("global");

    let scaffoldConfig = true;
    let updateGitignore = true;
    if (!useGlobal) {
      scaffoldConfig = await ctx.ui.confirm(
        "Forge: Init",
        "Scaffold .forge/config.json with defaults?",
      );
      updateGitignore = await ctx.ui.confirm("Forge: Init", "Add forge entries to .gitignore?");
    }

    const args = [setupScript];
    if (!scaffoldConfig) args.push("--no-config");
    if (!updateGitignore) args.push("--no-gitignore");
    if (useGlobal) args.push("--global");
    args.push("--yes", "--cwd", process.cwd());

    try {
      await execFileAsync("node", args);
      ctx.ui.notify(
        "Feature Forge initialized successfully — restart pi to load the scaffolded agents and flows",
        "info",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      ctx.ui.notify(`Setup failed: ${message}`, "error");
    }
  };
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export abstract class Phase {
  abstract readonly name: string;
  abstract readonly description: string;

  private readonly dir: string;
  /** Set by registerPhases before the command is registered. */
  protected pi!: ExtensionAPI;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Load a main prompt from this phase's `prompts/` directory. */
  protected loadPrompt(name: string): string {
    return readFileSync(join(this.dir, "prompts", `${name}.md`), "utf-8").trim();
  }

  /** Load a sub-agent instruction from this phase's `agents/` directory. */
  protected loadAgent(name: string): string {
    return readFileSync(join(this.dir, "agents", `${name}.md`), "utf-8").trim();
  }

  abstract handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void>;
}

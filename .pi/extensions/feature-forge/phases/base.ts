import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export abstract class Phase {
  protected readonly pi: ExtensionAPI;
  private readonly dir: string;

  constructor(pi: ExtensionAPI, dir: string) {
    this.pi = pi;
    this.dir = dir;
  }

  abstract readonly name: string;
  abstract readonly description: string;

  /** Register this phase's command. Called by registerPhases after construction. */
  register(): void {
    this.pi.registerCommand(this.name, {
      description: this.description,
      handler: this.handler.bind(this),
    });
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

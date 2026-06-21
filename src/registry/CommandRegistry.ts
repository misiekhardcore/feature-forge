import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Registry } from "./Registry";
import type { CommandDeps } from "./CommandDeps";
import { Command } from "../commands/Command";

type CommandConstructor = new (deps: CommandDeps) => Command;

export class CommandRegistry extends Registry<Command> {
  constructor(private deps: CommandDeps) {
    super();
  }

  register(ctor: CommandConstructor): Command {
    const instance = new ctor(this.deps);
    if (this.items.has(instance.name)) {
      throw new Error(`Command already registered: ${instance.name}`);
    }
    this.items.set(instance.name, instance);
    this.deps.pi.registerCommand(instance.name, {
      description: instance.description,
      handler: (args: string, ctx: ExtensionCommandContext) => instance.execute(args, ctx),
    });
    return instance;
  }

  registerAll(ctors: CommandConstructor[]): Command[] {
    return ctors.map((ctor) => this.register(ctor));
  }
}

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { AgentSupervisor } from "../agents";
import { Command } from "../commands";
import { Registry } from "./Registry";

export class CommandRegistry extends Registry<Command> {
  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly pi: ExtensionAPI,
  ) {
    super();
  }

  register(constructor: new (supervisor: AgentSupervisor, pi?: ExtensionAPI) => Command): Command {
    const command = new constructor(this.supervisor, this.pi);
    if (this.items.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }
    this.items.set(command.name, command);

    // pi's registerCommand() internally uses { ...options } spread, which only
    // copies own enumerable properties. Class prototype methods (like handler)
    // are silently dropped. Wrap handler into a plain object with an own
    // arrow-function property so it survives the spread.
    this.pi.registerCommand(command.name, {
      ...command,
      handler: (args: string, ctx: ExtensionCommandContext) => command.handler(args, ctx),
    });

    return command;
  }

  registerAll(
    ...constructors: (new (supervisor: AgentSupervisor, pi?: ExtensionAPI) => Command)[]
  ): Command[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

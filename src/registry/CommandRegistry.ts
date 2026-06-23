import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

  register(constructor: new (supervisor: AgentSupervisor, pi: ExtensionAPI) => Command): Command {
    const command = new constructor(this.supervisor, this.pi);
    if (this.items.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }
    this.items.set(command.name, command);
    this.pi.registerCommand(command.name, command);
    return command;
  }

  registerAll(
    ...constructors: (new (supervisor: AgentSupervisor, pi: ExtensionAPI) => Command)[]
  ): Command[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

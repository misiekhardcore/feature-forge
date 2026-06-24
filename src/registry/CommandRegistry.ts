import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { AgentSupervisor } from "../agents";
import { Command } from "../commands";
import type { WorkspaceManager } from "../workspace";
import { Registry } from "./Registry";

/**
 * Constructor shape for commands registered via {@link CommandRegistry}.
 *
 * The optional third param `workspaceManager` is forwarded to every command.
 * Commands that need workspace access use it; others ignore it.
 */
type CommandConstructor = new (
  supervisor: AgentSupervisor,
  pi: ExtensionAPI,
  workspaceManager?: WorkspaceManager,
) => Command;

export class CommandRegistry extends Registry<Command> {
  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly pi: ExtensionAPI,
    private readonly workspaceManager?: WorkspaceManager,
  ) {
    super();
  }

  register(constructor: CommandConstructor): Command {
    const command = new constructor(this.supervisor, this.pi, this.workspaceManager);
    if (this.items.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }
    this.set(command.name, command);

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

  registerAll(...constructors: CommandConstructor[]): Command[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

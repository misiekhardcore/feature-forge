import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Registry } from "@feature-forge/shared";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { Command } from "../commands";
import { ToolRegistry } from "../registry/ToolRegistry";
import type { WorkspaceManager, WorktreeRegistry } from "../workspace";

/**
 * Prefix a command name with `forge:` unless it already carries the prefix.
 *
 * All feature-forge commands are exposed as `/forge:<name>` in pi — the
 * prefix is implicit and never stored in flow files or command classes.
 */
export function withForgePrefix(name: string): string {
  return name.startsWith("forge:") ? name : `forge:${name}`;
}

/**
 * Constructor shape for commands registered via {@link CommandRegistry}.
 *
 * The optional params are forwarded to every command.
 */
type CommandConstructor = new (
  supervisor: AgentSupervisor,
  pi: ExtensionAPI,
  specManager: SpecManager,
  toolRegistry: ToolRegistry,
  workspaceManager?: WorkspaceManager,
  commandRegistry?: CommandRegistry,
  worktreeRegistry?: WorktreeRegistry,
) => Command;

export class CommandRegistry extends Registry<Command> {
  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly pi: ExtensionAPI,
    private readonly specManager: SpecManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly workspaceManager?: WorkspaceManager,
    private readonly worktreeRegistry?: WorktreeRegistry,
  ) {
    super();
  }

  register(constructor: CommandConstructor): Command {
    const command = new constructor(
      this.supervisor,
      this.pi,
      this.specManager,
      this.toolRegistry,
      this.workspaceManager,
      this,
      this.worktreeRegistry,
    );
    const registeredName = withForgePrefix(command.name);
    if (this.items.has(registeredName)) {
      throw new Error(`Command already registered: ${registeredName}`);
    }
    this.set(registeredName, command);

    // pi's registerCommand() internally uses { ...options } spread, which only
    // copies own enumerable properties. Class prototype methods (like handler)
    // are silently dropped. Wrap handler into a plain object with an own
    // arrow-function property so it survives the spread.
    this.pi.registerCommand(registeredName, {
      ...command,
      handler: (args: string, ctx: ExtensionCommandContext) => command.handler(args, ctx),
    });

    return command;
  }

  /**
   * Register a pre-constructed {@link Command} instance directly.
   *
   * Use this for commands that need constructor-injected dependencies
   * beyond the standard {@link CommandConstructor} signature, such as
   * flow-specific commands that require flow data.
   *
   * @throws If a command with the same name is already registered.
   */
  registerInstance(command: Command): Command {
    const registeredName = withForgePrefix(command.name);
    if (this.items.has(registeredName)) {
      throw new Error(`Command already registered: ${registeredName}`);
    }
    this.set(registeredName, command);

    this.pi.registerCommand(registeredName, {
      ...command,
      handler: (args: string, ctx: ExtensionCommandContext) => command.handler(args, ctx),
    });

    return command;
  }

  registerAll(...constructors: CommandConstructor[]): Command[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { Command, type CommandDeps } from "../commands/Command";
import type { ActiveFlowRegistry } from "../flows/ActiveFlowRegistry";
import type { WorkspaceManager, WorktreeRegistry } from "../workspace";
import { Registry } from "./Registry";
import { ToolRegistry } from "./ToolRegistry";

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
 * The dependency bag is forwarded to every command.
 */
type CommandConstructor = new (deps: CommandDeps) => Command;

export class CommandRegistry extends Registry<Command> {
  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly pi: ExtensionAPI,
    private readonly specManager: SpecManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly workspaceManager?: WorkspaceManager,
    private readonly worktreeRegistry?: WorktreeRegistry,
    private readonly activeFlow?: ActiveFlowRegistry,
  ) {
    super();
  }

  register(constructor: CommandConstructor): Command {
    const command = new constructor({
      supervisor: this.supervisor,
      pi: this.pi,
      specManager: this.specManager,
      toolRegistry: this.toolRegistry,
      workspaceManager: this.workspaceManager,
      commandRegistry: this,
      worktreeRegistry: this.worktreeRegistry,
      activeFlow: this.activeFlow,
    });
    const registeredName = withForgePrefix(command.name);
    if (this.items.has(registeredName)) {
      throw new Error(`Command already registered: ${registeredName}`);
    }
    this.set(registeredName, command);

    // pi's registerCommand() internally uses `{ name, sourceInfo, ...options }`,
    // so any `name` carried by the command itself would override the
    // registered (prefixed) name. Strip it, then wrap handler into an own
    // arrow-function property — pi's spread drops prototype methods.
    const { name: _declaredName, ...commandOptions } = command;
    this.pi.registerCommand(registeredName, {
      ...commandOptions,
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

    // Strip the declared name so pi's `...options` spread cannot override
    // the registered (prefixed) name.
    const { name: _declaredName, ...commandOptions } = command;
    this.pi.registerCommand(registeredName, {
      ...commandOptions,
      handler: (args: string, ctx: ExtensionCommandContext) => command.handler(args, ctx),
    });

    return command;
  }

  registerAll(...constructors: CommandConstructor[]): Command[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

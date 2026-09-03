import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import type { ForgeConfigData } from "../config";
import type { ActiveFlowRegistry } from "../flows/ActiveFlowRegistry";
import type { CommandRegistry } from "../registry/CommandRegistry";
import type { ToolRegistry } from "../registry/ToolRegistry";
import type { WorkspaceManager, WorktreeRegistry } from "../workspace";

/**
 * Dependency bag for {@link Command}. `pi` is always required; every other
 * dependency is optional - commands that require one narrow the inherited
 * field via `declare`.
 */
export interface CommandDeps {
  pi: ExtensionAPI;
  supervisor?: AgentSupervisor;
  specManager?: SpecManager;
  toolRegistry?: ToolRegistry;
  workspaceManager?: WorkspaceManager;
  commandRegistry?: CommandRegistry;
  worktreeRegistry?: WorktreeRegistry;
  activeFlow?: ActiveFlowRegistry;
  /** Resolved forge config, threaded by the composition root. */
  config?: Readonly<ForgeConfigData>;
}

/**
 * A command shaped like pi's registered-command contract. `Command`
 * implements this exactly; the type is the compile-time contract between
 * core commands and pi's {@link RegisteredCommand} shape.
 */
export type FlowCommand = Omit<RegisteredCommand, "sourceInfo">;

/**
 * Command abstraction that follows pi's CommandDefinition shape exactly.
 */
export abstract class Command implements FlowCommand {
  protected readonly pi: ExtensionAPI;
  protected readonly supervisor: AgentSupervisor | undefined;
  protected readonly specManager: SpecManager | undefined;
  protected readonly toolRegistry: ToolRegistry | undefined;
  protected readonly workspaceManager: WorkspaceManager | undefined;
  protected readonly commandRegistry: CommandRegistry | undefined;
  protected readonly worktreeRegistry: WorktreeRegistry | undefined;
  protected readonly activeFlow: ActiveFlowRegistry | undefined;
  protected readonly config: Readonly<ForgeConfigData> | undefined;

  constructor(deps: CommandDeps) {
    this.pi = deps.pi;
    this.supervisor = deps.supervisor;
    this.specManager = deps.specManager;
    this.toolRegistry = deps.toolRegistry;
    this.workspaceManager = deps.workspaceManager;
    this.commandRegistry = deps.commandRegistry;
    this.worktreeRegistry = deps.worktreeRegistry;
    this.activeFlow = deps.activeFlow;
    this.config = deps.config;
  }
  abstract readonly name: string;
  abstract readonly description?: string;
  abstract handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

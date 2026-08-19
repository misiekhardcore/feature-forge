import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import type { AgentSupervisor } from "@feature-forge/core/src/agents";
import type { SpecManager } from "@feature-forge/core/src/agents/SpecManager";
import type { ActiveFlowRegistry } from "@feature-forge/core/src/flows/ActiveFlowRegistry";
import type { CommandRegistry } from "@feature-forge/core/src/registry/CommandRegistry";
import { ToolRegistry } from "@feature-forge/core/src/registry/ToolRegistry";
import type { WorkspaceManager, WorktreeRegistry } from "@feature-forge/core/src/workspace";

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
}

/**
 * A command shaped like pi's registered-command contract. The `Command`
 * base implements this exactly; the alias is the seam between core's flow
 * engine and the command registry.
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

  constructor(deps: CommandDeps) {
    this.pi = deps.pi;
    this.supervisor = deps.supervisor;
    this.specManager = deps.specManager;
    this.toolRegistry = deps.toolRegistry;
    this.workspaceManager = deps.workspaceManager;
    this.commandRegistry = deps.commandRegistry;
    this.worktreeRegistry = deps.worktreeRegistry;
    this.activeFlow = deps.activeFlow;
  }
  abstract readonly name: string;
  abstract readonly description?: string;
  abstract handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

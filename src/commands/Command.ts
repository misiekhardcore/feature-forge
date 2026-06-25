import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import type { WorkspaceManager } from "../workspace";

/**
 * Command abstraction that follows pi's CommandDefinition shape exactly.
 */
export abstract class Command implements Omit<RegisteredCommand, "sourceInfo"> {
  constructor(
    protected readonly supervisor: AgentSupervisor,
    protected readonly pi: ExtensionAPI,
    protected readonly specManager: SpecManager,
    protected readonly workspaceManager?: WorkspaceManager,
  ) {}
  abstract readonly name: string;
  abstract readonly description?: string;
  abstract handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";

import { AgentSupervisor } from "../agents";

/**
 * Command abstraction that follows pi's CommandDefinition shape exactly.
 */
export abstract class Command implements Omit<RegisteredCommand, "sourceInfo"> {
  constructor(
    protected readonly supervisor: AgentSupervisor,
    protected readonly pi: ExtensionAPI,
  ) {}
  abstract readonly name: string;
  abstract readonly description?: string;
  abstract handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

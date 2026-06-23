import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

/**
 * Tool abstraction that follows pi's ToolDefinition shape exactly.
 *
 * Execute matches pi's native signature so no wrapping is needed at registration time.
 * Each tool carries its own parameters schema.
 */
export abstract class Tool<
  TParams extends TSchema = TSchema,
  TDetails = unknown,
  TState = unknown,
> implements ToolDefinition<TParams, TDetails, TState> {
  abstract readonly name: string;
  abstract readonly label: string;
  abstract readonly description: string;
  abstract readonly parameters: TParams;

  abstract execute(
    toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<TDetails>>;
}

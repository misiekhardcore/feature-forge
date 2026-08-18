import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { logger } from "../logging";
import { Tool } from "./Tool";

/** Error details returned when the IPC client is unavailable. */
export const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

/**
 * Structural contract for the IPC client an {@link IpcTool} proxies to.
 *
 * Shared cannot import the cli package's wire types, so any client exposing a
 * `request(type, params, timeout?, signal?)` method qualifies. The cli's
 * `ChildSocketClient` satisfies this structurally — method-signature
 * bivariance keeps its generic `request` assignable to this signature.
 */
export interface IpcRequestClient {
  request(type: string, params: unknown, timeout?: number, signal?: AbortSignal): Promise<unknown>;
}

/**
 * Base class for tools that proxy a request to a child process over IPC.
 *
 * Implements the skeleton every IPC tool used to duplicate: the null-client
 * guard, abort checks, request dispatch, result stringification, and the
 * single error-details shape. Concrete tools only declare their schema and
 * renderers plus a one-line `execute` when a non-default timeout is needed.
 */
export abstract class IpcTool<TParams extends TSchema = TSchema, TResult = unknown> extends Tool<
  TParams,
  TResult | { error: string }
> {
  constructor(protected readonly client: IpcRequestClient | null) {
    super();
  }

  /** The request type this tool issues (a `SocketMessage["type"]` literal). */
  protected abstract readonly messageType: string;

  protected async ipc(
    params: unknown,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<TResult | { error: string }>> {
    if (!this.client) {
      signal?.throwIfAborted();
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    signal?.throwIfAborted();

    try {
      const result = (await this.client.request(
        this.messageType,
        params,
        timeout,
        signal,
      )) as TResult;
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      logger.error("Tool execution failed", { toolName: this.name, error });
      const errorDetails = { error: error instanceof Error ? error.message : String(error) };
      return {
        content: [{ type: "text", text: JSON.stringify(errorDetails) }],
        details: errorDetails,
      };
    }
  }

  async execute(
    _toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    _onUpdate?: AgentToolUpdateCallback<TResult | { error: string }>,
    _ctx?: ExtensionContext,
  ): Promise<AgentToolResult<TResult | { error: string }>> {
    return this.ipc(params, undefined, signal);
  }
}

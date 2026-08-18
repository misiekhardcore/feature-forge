import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";

import { jsonParse } from "@feature-forge/core";
import { ForgeConfig, logger } from "@feature-forge/core";

import { IpcConnectionError, IpcRequestError, IpcTimeoutError } from "./errors";
import type { ParamsToResponseMap, SocketMessage, SocketPush, SocketResponse } from "./messages";

/**
 * Client for connecting to the parent's `ParentSocketServer` over a Unix socket.
 *
 * Usage (inside a child extension):
 * ```ts
 * const client = new ChildSocketClient(process.env.FORGE_PARENT_SOCKET!);
 * await client.connect();
 *
 * const result = await client.request("spawn_agent", {
 *   role: "researcher",
 *   systemPrompt: "Resolved persona text",
 *   toolRestrictions: { read: [], grep: [] },
 * });
 *
 * client.onPush((event) => {
 *   if (event.type === "agent_update") { ... }
 * });
 * ```
 */
export class ChildSocketClient {
  private socket: Socket | null = null;

  /** In-flight connect attempt; guards against double-connect. */
  private connectPromise: Promise<void> | null = null;

  /** Map of correlationId → pending promise resolvers. */
  private pending = new Map<
    string,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  /** Registered push event handlers. */
  private pushHandlers: Array<(event: SocketPush) => void> = [];

  private buffer = "";

  constructor(private readonly socketPath: string) {}

  /**
   * Connect to the parent socket.
   * Throws IpcConnectionError if the connection fails.
   * Calling this again while connected, or while a previous attempt is
   * still in flight, reuses the existing connection (no-op).
   */
  async connect(): Promise<void> {
    if (this.socket) {
      return; // Already connected.
    }

    if (!this.connectPromise) {
      this.connectPromise = new Promise<void>((resolve, reject) => {
        const socket = connect(this.socketPath, () => {
          this.socket = socket;
          socket.setTimeout(0);
          resolve();
        });

        socket.on("data", (chunk: Buffer) => {
          this.handleData(chunk);
        });

        socket.on("error", (error) => {
          if (!this.socket) {
            reject(new IpcConnectionError(`Failed to connect to ${this.socketPath}`, error));
          } else {
            // Transport error after connection: reject pending requests so no
            // caller waits out the timeout (error-first ordering must not leak;
            // the close handler that follows only resets state).
            this.rejectAllPending(
              new IpcConnectionError(`Connection to ${this.socketPath} failed`, error),
            );
          }
        });

        socket.on("close", () => {
          if (this.socket !== socket) {
            return; // Stale close from a superseded connect attempt.
          }
          this.socket = null;
          this.connectPromise = null;
          this.rejectAllPending(new IpcConnectionError(`Connection to ${this.socketPath} closed`));
        });
      });
    }

    try {
      await this.connectPromise;
    } catch (error) {
      // Allow a retry after a failed connection attempt.
      this.connectPromise = null;
      throw error;
    }
  }

  /**
   * Send a request and wait for the matching response.
   *
   * @param type — The message type.
   * @param params — The request parameters.
   * @param timeout — Milliseconds to wait before throwing IpcTimeoutError (default 5 minutes).
   * @param signal — Optional AbortSignal to cancel the pending request.
   */
  async request<ST extends SocketMessage["type"]>(
    type: ST,
    params: Extract<SocketMessage, { type: ST }>["params"],
    timeout = ForgeConfig.getInstance().getTaskTimeoutMs(),
    signal?: AbortSignal,
  ): Promise<ParamsToResponseMap[ST]> {
    const correlationId = randomUUID();

    signal?.throwIfAborted();

    const socket = this.socket;
    if (!socket) {
      // Reject immediately instead of silently no-op'ing the write and
      // making the caller wait out the full timeout.
      throw new IpcConnectionError(`Not connected to ${this.socketPath}`);
    }

    return new Promise((resolve, reject) => {
      const message = { type, correlationId, params };

      // Timeout
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new IpcTimeoutError(correlationId, timeout));
      }, timeout);

      const onAbort = (): void => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = (): void => {
        clearTimeout(timer);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      // Register the pending entry before writing: a response that arrives
      // immediately after the write must find its entry already in place,
      // otherwise it would be dropped as stale and the request would hang.
      this.pending.set(correlationId, {
        resolve: (value) => {
          cleanup();
          resolve(value as ParamsToResponseMap[ST]);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });

      socket.write(JSON.stringify(message) + "\n");
    });
  }

  /**
   * Register a handler for push events from the server.
   */
  onPush(handler: (event: SocketPush) => void): void {
    this.pushHandlers.push(handler);
  }

  /**
   * Disconnect from the parent socket.
   */
  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.socket!.end(() => {
        this.socket = null;
        this.connectPromise = null;
        resolve();
      });
    });
  }

  // ─── Data handling ──────────────────────────────────────────────────

  /**
   * Reject every pending request (e.g. on transport close) so no caller
   * waits out the timeout after the connection dies.
   */
  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = jsonParse<Record<string, unknown>>(trimmed);
        this.handleMessage(parsed);
      } catch (error) {
        logger.warn("Malformed IPC JSON, skipping", { error });
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(parsed: Record<string, unknown>): void {
    if (this.isSocketResponse(parsed)) {
      this.handleResponse(parsed);
    } else if (this.isSocketPush(parsed)) {
      this.handlePush(parsed);
    }
  }

  private isSocketResponse(parsed: Record<string, unknown>): parsed is SocketResponse {
    return parsed.type === "result" || parsed.type === "error";
  }

  private isSocketPush(parsed: Record<string, unknown>): parsed is SocketPush {
    return parsed.type === "agent_update";
  }

  private handleResponse(response: SocketResponse): void {
    const pending = this.pending.get(response.correlationId);
    if (!pending) {
      return; // Unknown correlation — could be stale
    }

    this.pending.delete(response.correlationId);

    if (response.type === "result") {
      pending.resolve(response.result);
    } else {
      pending.reject(new IpcRequestError(response.correlationId, response.error));
    }
  }

  private handlePush(push: SocketPush): void {
    for (const handler of this.pushHandlers) {
      try {
        handler(push);
      } catch (error) {
        logger.warn("Push handler threw", { error });
        // Handler error — don't let it break the client
      }
    }
  }
}

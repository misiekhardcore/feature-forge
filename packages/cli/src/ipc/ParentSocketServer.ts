import { mkdtempSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import type { SpecManager } from "../agents";
import { AgentSupervisor, isSubprocessAgent } from "../agents";
import { logger } from "../logging";
import {
  type SendTaskParams,
  type SocketMessage,
  type SocketPush,
  type SocketResponse,
  SocketResponseResult,
  type SpawnAgentParams,
} from "./messages";

/**
 * Unix socket server that routes IPC requests from child agents to the
 * parent supervisor.
 *
 * Usage:
 * ```ts
 * const server = new ParentSocketServer(supervisor, pi);
 * const socketPath = await server.start();
 * // Pass socketPath to child processes via env var
 * // Server auto-stops on session_shutdown
 * ```
 *
 * Protocol:
 * - Messages are newline-delimited JSON.
 * - Each request must have a unique `correlationId`.
 * - Push events (agent_update) are sent as separate JSON lines.
 */
export class ParentSocketServer {
  private server: Server | null = null;
  private socketPath: string | null = null;
  private connectedSockets = new Set<Socket>();

  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly pi: ExtensionAPI,
    private readonly specManager: SpecManager,
  ) {}

  /**
   * Start listening on a randomly-named Unix socket.
   * Returns the socket path that clients should connect to.
   */
  async start(): Promise<string> {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-"));
    this.socketPath = join(tempDir, "parent.sock");

    return new Promise<string>((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (error) => {
        reject(error);
      });

      this.server.listen(this.socketPath!, () => {
        resolve(this.socketPath!);
      });

      this.pi.on("session_shutdown", async () => {
        await this.stop();
      });
    });
  }

  /**
   * Stop the server and clean up the socket file.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Close all connected client sockets
    for (const socket of this.connectedSockets) {
      socket.end();
    }
    this.connectedSockets.clear();

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.socketPath = null;
        resolve();
      });
    });
  }

  /**
   * The path this server is listening on, or null if not started.
   */
  get path(): string | null {
    return this.socketPath;
  }

  // ─── Connection handling ────────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    this.connectedSockets.add(socket);

    let buffer = "";

    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");

      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        try {
          const message: SocketMessage = JSON.parse(trimmed) as SocketMessage;
          void this.handleMessage(socket, message);
        } catch (error) {
          this.sendError(socket, "unknown", `Invalid JSON: ${String(error)}`);
        }
      }
    });

    socket.on("close", () => {
      this.connectedSockets.delete(socket);
    });

    socket.on("error", () => {
      this.connectedSockets.delete(socket);
    });
  }

  private async handleMessage(socket: Socket, message: SocketMessage): Promise<void> {
    try {
      switch (message.type) {
        case "spawn_agent":
          await this.handleSpawnAgent(socket, message.correlationId, message.params);
          break;
        case "send_task":
          await this.handleSendTask(socket, message.correlationId, message.params);
          break;
        case "get_agent_result":
          await this.handleGetAgentResult(socket, message.correlationId, message.params);
          break;
        case "list_agents":
          await this.handleListAgents(socket, message.correlationId);
          break;
        case "destroy_agent":
          await this.handleDestroyAgent(socket, message.correlationId, message.params);
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Message handler failed", { correlationId: message.correlationId, error });
      this.sendError(socket, message.correlationId, errorMessage);
    }
  }

  // ─── Message handlers ───────────────────────────────────────────────

  private async handleSpawnAgent(
    socket: Socket,
    correlationId: string,
    params: SpawnAgentParams,
  ): Promise<void> {
    const specification = this.specManager.createDynamic(params);
    const agent = await this.supervisor.spawnGuest(specification);

    this.sendResponse(socket, correlationId, {
      agentId: agent.id,
      role: agent.specification.role,
    });
  }

  private async handleSendTask(
    socket: Socket,
    correlationId: string,
    params: SendTaskParams,
  ): Promise<void> {
    const agent = this.supervisor.getAgent(params.agentId);
    if (!agent) {
      this.sendError(socket, correlationId, `Agent not found: ${params.agentId}`);
      return;
    }

    if (!isSubprocessAgent(agent)) {
      this.sendError(socket, correlationId, `Agent not a subprocess agent: ${params.agentId}`);
      return;
    }

    if (params.await) {
      let socketClosed = false;

      const onSocketClose = (): void => {
        socketClosed = true;
        void this.supervisor.destroyAgent(params.agentId).catch((error) => {
          logger.warn("Failed to destroy agent on socket close", {
            agentId: params.agentId,
            error,
          });
        });
      };

      socket.once("close", onSocketClose);

      try {
        // Block until the agent completes
        const result = await agent.executeTask(params.prompt, {
          timeout: params.timeout,
          onEvent: (event) => {
            this.pi.events.emit("feature-forge:agent-stream", {
              details: { agentId: agent.id, event },
            });
          },
        });
        this.sendResponse(socket, correlationId, { result });
      } catch (error) {
        if (socketClosed) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.sendError(socket, correlationId, message);
        this.pushAgentUpdate(agent.id, AgentStatus.Failed, message);
      } finally {
        socket.removeListener("close", onSocketClose);
      }
    } else {
      // Fire and forget — respond immediately, push update later
      this.sendResponse(socket, correlationId, { status: "dispatched" });

      // Execute in background and push result when done
      agent
        .executeTask(params.prompt, {
          timeout: params.timeout,
          onEvent: (event) => {
            this.pi.events.emit("feature-forge:agent-stream", {
              details: { agentId: agent.id, event },
            });
          },
        })
        .then(
          (result) => {
            this.pushAgentUpdate(agent.id, AgentStatus.Completed, result);
          },
          (error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.pushAgentUpdate(agent.id, AgentStatus.Failed, message);
          },
        );
    }
  }

  private async handleGetAgentResult(
    socket: Socket,
    correlationId: string,
    params: { agentId: string },
  ): Promise<void> {
    const agent = this.supervisor.getAgent(params.agentId);
    if (!agent) {
      this.sendError(socket, correlationId, `Agent not found: ${params.agentId}`);
      return;
    }

    this.sendResponse(socket, correlationId, {
      status: agent.status,
      result:
        agent.status === AgentStatus.Completed && isSubprocessAgent(agent)
          ? agent.getResult()
          : null,
    });
  }

  private async handleListAgents(socket: Socket, correlationId: string): Promise<void> {
    const agents = this.supervisor.getAllAgents().map((agent) => ({
      agentId: agent.id,
      role: agent.specification.role,
      status: agent.status,
    }));

    this.sendResponse(socket, correlationId, { agents });
  }

  private async handleDestroyAgent(
    socket: Socket,
    correlationId: string,
    params: { agentId: string },
  ): Promise<void> {
    await this.supervisor.destroyAgent(params.agentId);
    this.sendResponse(socket, correlationId, { status: "destroyed" });
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private sendResponse(
    socket: Socket,
    correlationId: string,
    result: SocketResponseResult["result"],
  ): void {
    const response: SocketResponse = { type: "result", correlationId, result };
    socket.write(JSON.stringify(response) + "\n");
  }

  private sendError(socket: Socket, correlationId: string, error: string): void {
    const response: SocketResponse = { type: "error", correlationId, error };
    socket.write(JSON.stringify(response) + "\n");
  }

  /**
   * Broadcast an agent_update event to all connected clients.
   */
  private pushAgentUpdate(agentId: string, status: AgentStatus, result?: string): void {
    const push: SocketPush = {
      type: "agent_update",
      payload: {
        agentId,
        status,
        result,
      },
    };

    const serialized = JSON.stringify(push) + "\n";

    for (const socket of this.connectedSockets) {
      try {
        socket.write(serialized);
      } catch (error) {
        logger.warn("Socket send failed during push", { agentId, error });
        // Socket might have disconnected — it will be cleaned up
        // by the 'close' or 'error' event handler.
      }
    }
  }
}

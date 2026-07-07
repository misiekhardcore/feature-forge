import { connect, type Socket } from "node:net";

import { AgentStatus } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecification } from "../agents";
import type { Agent } from "../agents/agents";
import type { SubprocessAgent } from "../agents/agents/SubprocessAgent";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi, makeMockSpecManager } from "../test-utils";
import { ChildSocketClient } from "./ChildSocketClient";
import { IpcConnectionError } from "./errors";
import { ParentSocketServer } from "./ParentSocketServer";

function createMockAgent(overrides: Partial<SubprocessAgent> = {}): SubprocessAgent {
  const id = "test-agent";
  return {
    id,
    specification: {
      role: "test",
      systemPrompt: "",
      tools: ["read"],
      id,
    } as never,
    status: AgentStatus.Running,
    createdAt: new Date(),
    executeTask: vi.fn().mockResolvedValue("task result"),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue("task result"),
    getError: vi.fn().mockReturnValue(undefined),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
    ...overrides,
  } as SubprocessAgent;
}

function createMockSupervisor(customAgents?: Map<string, Agent>): AgentSupervisor {
  const agents = customAgents ?? new Map<string, Agent>();
  return {
    spawnGuest: vi.fn().mockImplementation(async (specification: AgentSpecification) => {
      const id = specification.id;
      const existing = agents.get(id);
      if (existing) {
        return existing;
      }
      const agent = createMockAgent();
      Object.defineProperty(agent, "id", { value: id });
      agents.set(id, agent);
      return Promise.resolve(agent);
    }),
    mountInSession: vi.fn().mockResolvedValue(undefined),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation((id: string) => agents.delete(id)),
    destroyAll: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Read exactly one JSON line from a socket (buffering across chunks).
 */
function createLineReader() {
  let buffer = "";
  return function readNextLine(socket: Socket): Promise<unknown> {
    // Check if the buffer already has a complete line
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      return Promise.resolve(JSON.parse(line));
    }

    return new Promise((resolve, reject) => {
      const handler = (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const idx = buffer.indexOf("\n");
        if (idx !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          socket.removeListener("data", handler);
          resolve(JSON.parse(line));
        }
      };
      socket.on("data", handler);
      // Timeout safety
      setTimeout(() => {
        socket.removeListener("data", handler);
        reject(new Error("Timeout waiting for line"));
      }, 3000);
    });
  };
}

describe("ParentSocketServer edge cases", () => {
  let server: ParentSocketServer;
  let supervisor: AgentSupervisor;

  beforeEach(async () => {
    supervisor = createMockSupervisor();
    server = new ParentSocketServer(supervisor, makeMockPi(), makeMockSpecManager());
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("handles double stop gracefully", async () => {
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it("reports Running status via get_agent_result", async () => {
    const client = connect(server.path!);
    const read = createLineReader();

    // Spawn
    client.write(
      JSON.stringify({
        type: "spawn_agent",
        correlationId: "g1",
        params: { role: "worker", systemPrompt: "x", tools: ["read"] },
      }) + "\n",
    );
    const spawnResponse = (await read(client)) as { result: { agentId: string } };

    // Get result using the actual agentId from the spawn response
    client.write(
      JSON.stringify({
        type: "get_agent_result",
        correlationId: "g2",
        params: { agentId: spawnResponse.result.agentId },
      }) + "\n",
    );

    const response = await read(client);
    expect(response).toMatchObject({
      type: "result",
      correlationId: "g2",
      result: { status: "Running" },
    });

    client.end();
  });

  it("covers fire-and-forget push on task success", async () => {
    const client = connect(server.path!);
    const read = createLineReader();

    // Spawn agent
    client.write(
      JSON.stringify({
        type: "spawn_agent",
        correlationId: "s1",
        params: { role: "pusher", systemPrompt: "x", tools: ["read"] },
      }) + "\n",
    );
    const spawnResponse = (await read(client)) as { result: { agentId: string } };

    // Fire-and-forget task
    client.write(
      JSON.stringify({
        type: "send_task",
        correlationId: "s2",
        params: {
          agentId: spawnResponse.result.agentId,
          prompt: "background work",
          await: false,
        },
      }) + "\n",
    );

    // Response should be immediate "dispatched"
    const dispatchResponse = await read(client);
    expect(dispatchResponse).toMatchObject({
      type: "result",
      correlationId: "s2",
      result: { status: "dispatched" },
    });

    // Wait for push event (the mock agent resolves on next microtask)
    await vi.waitFor(
      async () => {
        const pushResponse = await read(client);
        expect(pushResponse).toMatchObject({
          type: "agent_update",
          payload: { status: "Completed" },
        });
        return true;
      },
      { timeout: 2000, interval: 50 },
    );

    client.end();
  });

  it("covers fire-and-forget push on task failure", async () => {
    const failingAgent = createMockAgent({
      executeTask: vi.fn().mockRejectedValue(new Error("task failed")),
    });

    // Custom supervisor that always returns the failing agent for "failer" role
    const customSupervisor = {
      spawnGuest: vi.fn().mockImplementation(async (specification: AgentSpecification) => {
        Object.defineProperty(failingAgent, "id", { value: specification.id });
        return failingAgent;
      }),
      mountInSession: vi.fn().mockResolvedValue(undefined),
      runAgent: vi.fn().mockResolvedValue(undefined),
      getAgent: vi.fn().mockReturnValue(failingAgent),
      getAllAgents: vi.fn().mockReturnValue([]),
      destroyAgent: vi.fn().mockResolvedValue(undefined),
      destroyAll: vi.fn().mockResolvedValue(undefined),
    } as AgentSupervisor;

    const customServer = new ParentSocketServer(
      customSupervisor,
      makeMockPi(),
      makeMockSpecManager(),
    );
    const customPath = await customServer.start();

    const client = connect(customPath);
    const read = createLineReader();

    client.write(
      JSON.stringify({
        type: "spawn_agent",
        correlationId: "f1",
        params: { role: "failer", systemPrompt: "x", tools: ["read"] },
      }) + "\n",
    );
    const spawnResponse = (await read(client)) as { result: { agentId: string } };

    client.write(
      JSON.stringify({
        type: "send_task",
        correlationId: "f2",
        params: {
          agentId: spawnResponse.result.agentId,
          prompt: "will fail",
          await: false,
        },
      }) + "\n",
    );

    const dispatchResponse = await read(client);
    expect(dispatchResponse).toMatchObject({
      type: "result",
      correlationId: "f2",
      result: { status: "dispatched" },
    });

    // Wait for push event with error
    await vi.waitFor(
      async () => {
        const pushResponse = await read(client);
        expect(pushResponse).toMatchObject({
          type: "agent_update",
          payload: { status: "Failed" },
        });
        return true;
      },
      { timeout: 2000, interval: 50 },
    );

    client.end();
    await customServer.stop();
  });
});

describe("ChildSocketClient edge cases", () => {
  let server: ParentSocketServer;
  let supervisor: AgentSupervisor;
  let socketPath: string;

  beforeEach(async () => {
    supervisor = createMockSupervisor();
    server = new ParentSocketServer(supervisor, makeMockPi(), makeMockSpecManager());
    socketPath = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("handles disconnect called twice gracefully", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();
    await client.disconnect();
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it("throws IpcConnectionError for a non-existent socket path", async () => {
    const client = new ChildSocketClient("/tmp/non-existent-socket.sock");
    await expect(client.connect()).rejects.toThrow(IpcConnectionError);
  });

  it("ignores unknown correlation IDs from the server (stale response)", async () => {
    const childClient = new ChildSocketClient(socketPath);
    await childClient.connect();

    // Use a raw socket to send a spoofed response with a correlationId
    // the ChildSocketClient never requested
    const hijacker = connect(socketPath);
    await new Promise<void>((resolve) =>
      hijacker.once("connect", () => {
        resolve();
      }),
    );

    hijacker.write(
      JSON.stringify({
        type: "result",
        correlationId: "stale-correlation",
        result: "should be ignored",
      }) + "\n",
    );
    hijacker.end();

    // Wait a tick for the message to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The client should still work fine
    const result = await childClient.request("list_agents", {});
    expect(result).toEqual({ agents: [] });

    await childClient.disconnect();
  });
});

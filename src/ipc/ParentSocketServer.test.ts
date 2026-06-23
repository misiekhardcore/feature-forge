import { connect, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../agents/agents";
import { AgentIdentifier, AgentStatus } from "../agents/base";
import type { AgentSupervisor } from "../agents/supervisors";
import { ParentSocketServer } from "./ParentSocketServer";

function createMockAgent(): Agent {
  const identifier = new AgentIdentifier("test-agent");
  return {
    identifier,
    specification: {
      role: "test",
      systemPrompt: "",
      toolNames: ["read"],
      identifier,
    } as never,
    status: AgentStatus.Running,
    executeTask: vi.fn().mockResolvedValue("task result"),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue("task result"),
    getError: vi.fn().mockReturnValue(undefined),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
  };
}

function createMockSupervisor(agents: Map<string, Agent> = new Map()): AgentSupervisor {
  return {
    spawn: vi.fn().mockImplementation(async (specification) => {
      const agent = createMockAgent();
      const identifier = new AgentIdentifier(specification.role);
      Object.defineProperty(agent, "identifier", { value: identifier });
      agents.set(identifier.toString(), agent);
      return agent;
    }),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation(async (id) => agents.delete(id)),
    destroyAll: vi.fn().mockResolvedValue(undefined),
  };
}

function sendJson(socket: Socket, data: unknown): Promise<Error | null | undefined> {
  return new Promise<Error | null | undefined>((resolve) => {
    socket.write(JSON.stringify(data) + "\n", "utf-8", resolve);
  });
}

function readResponse(socket: Socket, timeout = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Response timeout"));
    }, timeout);
    const handler = (chunk: Buffer) => {
      clearTimeout(timer);
      const lines = chunk.toString("utf-8").trim().split("\n");
      resolve(JSON.parse(lines[0]));
    };
    socket.once("data", handler);
  });
}

describe("ParentSocketServer", () => {
  let server: ParentSocketServer;
  let supervisor: AgentSupervisor;
  let socketPath: string;

  beforeEach(async () => {
    supervisor = createMockSupervisor();
    server = new ParentSocketServer(supervisor);
    socketPath = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("returns a socket path after starting", () => {
    expect(socketPath).toBeTruthy();
    expect(socketPath).toContain("forge-ipc");
    expect(socketPath).toContain("parent.sock");
  });

  it("responds to a spawn_agent request", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "test-1",
      params: {
        role: "researcher",
        systemPrompt: "You are a researcher",
        toolNames: ["read", "grep"],
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "test-1",
      result: {
        agentIdentifier: "researcher",
        role: "researcher",
      },
    });

    client.end();
  });

  it("responds to a list_agents request", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "list_agents",
      correlationId: "test-2",
      params: {},
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "test-2",
      result: { agents: [] },
    });

    client.end();
  });

  it("responds with an error for an unknown agent", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "send_task",
      correlationId: "test-3",
      params: {
        agentIdentifier: "non-existent",
        task: "do something",
        await: true,
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "error",
      correlationId: "test-3",
      error: "Agent not found: non-existent",
    });

    client.end();
  });

  it("spawns an agent then sends it a task", async () => {
    const client = connect(socketPath);

    // Spawn
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "s1",
      params: {
        role: "worker",
        systemPrompt: "You are a worker",
        toolNames: ["read"],
      },
    });

    const spawnResponse = await readResponse(client);
    expect(spawnResponse).toEqual({
      type: "result",
      correlationId: "s1",
      result: { agentIdentifier: "worker", role: "worker" },
    });

    // Send task
    await sendJson(client, {
      type: "send_task",
      correlationId: "s2",
      params: {
        agentIdentifier: "worker",
        task: "Do the work",
        await: true,
      },
    });

    const taskResponse = await readResponse(client);
    expect(taskResponse).toEqual({
      type: "result",
      correlationId: "s2",
      result: { result: "task result" },
    });

    client.end();
  });

  it("destroys an agent", async () => {
    const client = connect(socketPath);

    // Spawn
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "d1",
      params: {
        role: "temp",
        systemPrompt: "temp",
        toolNames: ["read"],
      },
    });

    await readResponse(client);

    // Destroy
    await sendJson(client, {
      type: "destroy_agent",
      correlationId: "d2",
      params: {
        agentIdentifier: "temp",
      },
    });

    const destroyResponse = await readResponse(client);
    expect(destroyResponse).toEqual({
      type: "result",
      correlationId: "d2",
      result: { status: "destroyed" },
    });

    client.end();
  });

  it("validates JSON and returns error for malformed input", async () => {
    const client = connect(socketPath);

    client.write("not-json\n");

    const response = await readResponse(client);
    expect(response).toHaveProperty("type", "error");
    expect(response).toHaveProperty("correlationId", "unknown");

    client.end();
  });
});

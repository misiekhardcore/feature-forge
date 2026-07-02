import { connect, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../agents/agents";
import type { SubprocessAgent } from "../agents/agents/SubprocessAgent";
import { AgentStatus } from "../agents/base";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi } from "../test-utils";
import { ParentSocketServer } from "./ParentSocketServer";

function createMockAgent(): SubprocessAgent {
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
  } as unknown as SubprocessAgent;
}

function createMockSupervisor(agents: Map<string, Agent> = new Map()): AgentSupervisor {
  return {
    spawnGuest: vi.fn().mockImplementation(async (specification) => {
      const agent = createMockAgent();
      const id = specification.role;
      Object.defineProperty(agent, "id", { value: id });
      Object.defineProperty(agent, "specification", { value: specification });
      agents.set(id, agent);
      return agent;
    }),
    mountInSession: vi.fn().mockResolvedValue(undefined),
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
    server = new ParentSocketServer(supervisor, makeMockPi());
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
        label: "researcher",
        systemPrompt: "You are a researcher",
        tools: ["read", "grep"],
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "test-1",
      result: {
        agentId: "researcher",
        label: "researcher",
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
        agentId: "non-existent",
        prompt: "do something",
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
        label: "worker",
        systemPrompt: "You are a worker",
        tools: ["read"],
      },
    });

    const spawnResponse = await readResponse(client);
    expect(spawnResponse).toEqual({
      type: "result",
      correlationId: "s1",
      result: { agentId: "worker", label: "worker" },
    });

    // Send task
    await sendJson(client, {
      type: "send_task",
      correlationId: "s2",
      params: {
        agentId: "worker",
        prompt: "Do the work",
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

  it("handles send_task with await=false (fire and forget)", async () => {
    const client = connect(socketPath);

    // Spawn
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "f1",
      params: {
        label: "fireworker",
        systemPrompt: "You are a fire-and-forget worker",
        tools: ["read"],
      },
    });

    await readResponse(client);

    // Send task with await: false
    await sendJson(client, {
      type: "send_task",
      correlationId: "f2",
      params: {
        agentId: "fireworker",
        prompt: "Background work",
        await: false,
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "f2",
      result: { status: "dispatched" },
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
        label: "temp",
        systemPrompt: "temp",
        tools: ["read"],
      },
    });

    await readResponse(client);

    // Destroy
    await sendJson(client, {
      type: "destroy_agent",
      correlationId: "d2",
      params: {
        agentId: "temp",
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

  it("creates DynamicAgentSpecification directly from IPC params", async () => {
    const localSupervisor = createMockSupervisor();
    const regServer = new ParentSocketServer(localSupervisor, makeMockPi());
    const regSocketPath = await regServer.start();

    const client = connect(regSocketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "direct-spec",
      params: {
        label: "build",
        systemPrompt: "You are a builder agent",
        tools: ["read", "bash"],
        model: "claude-sonnet-4-5",
        cwd: "/tmp/ws",
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "direct-spec",
      result: {
        agentId: "build",
        label: "build",
      },
    });

    // Verify the supervisor received a DynamicAgentSpecification
    expect(localSupervisor.spawnGuest).toHaveBeenCalledOnce();
    const calledSpec = vi.mocked(localSupervisor.spawnGuest).mock.calls[0][0];
    expect(calledSpec.role).toBe("build");
    expect(calledSpec.systemPrompt).toBe("You are a builder agent");
    expect(calledSpec.tools).toEqual(["read", "bash"]);
    expect(calledSpec.model).toBe("claude-sonnet-4-5");
    expect(calledSpec.cwd).toBe("/tmp/ws");

    client.end();
    await regServer.stop();
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

import { connect, type Socket } from "node:net";

import { AgentStatus } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecification } from "../agents";
import type { Agent } from "../agents/agents";
import type { SubprocessAgent } from "../agents/agents/SubprocessAgent";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi, makeMockSpecManager } from "../test-utils";
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
    start: vi.fn(),
  };
}

let specManagerCall: { role: string; systemPrompt: string; tools: string[] } | null = null;

function createMockSpecManager() {
  specManagerCall = null;
  const manager = makeMockSpecManager();
  manager.createDynamic = vi.fn().mockImplementation((params) => {
    specManagerCall = params;
    return {
      id: params.role,
      role: params.role,
      systemPrompt: params.systemPrompt,
      tools: params.tools ?? [],
      model: params.model,
      cwd: params.cwd,
      disableBuiltinTools: false,
      disableExtensions: false,
      disableSkills: false,
      disablePromptTemplates: false,
      disableContextFiles: false,
      ephemeral: false,
      excludedTools: [],
      thinkingLevel: undefined,
    };
  });
  return manager;
}

function createMockSupervisor(agents: Map<string, Agent> = new Map()): AgentSupervisor {
  return {
    spawnGuest: vi.fn().mockImplementation(async (specification: AgentSpecification) => {
      const agent = createMockAgent();
      const id = specification.role;
      Object.defineProperty(agent, "id", { value: id });
      Object.defineProperty(agent, "specification", { value: specification });
      agents.set(id, agent);
      return agent;
    }),
    mountInSession: vi.fn().mockResolvedValue(undefined),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation(async (id: string) => agents.delete(id)),
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
    server = new ParentSocketServer(supervisor, makeMockPi(), createMockSpecManager());
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
        tools: ["read", "grep"],
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "test-1",
      result: {
        agentId: "researcher",
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
        role: "worker",
        systemPrompt: "You are a worker",
        tools: ["read"],
      },
    });

    const spawnResponse = await readResponse(client);
    expect(spawnResponse).toEqual({
      type: "result",
      correlationId: "s1",
      result: { agentId: "worker", role: "worker" },
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
        role: "fireworker",
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
        role: "temp",
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

  it("delegates spec construction to SpecManager.createDynamic", async () => {
    const localSpecManager = createMockSpecManager();
    const localSupervisor = createMockSupervisor();
    const regServer = new ParentSocketServer(localSupervisor, makeMockPi(), localSpecManager);
    const regSocketPath = await regServer.start();

    const client = connect(regSocketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "delegated-spec",
      params: {
        role: "build",
        systemPrompt: "You are a builder agent",
        tools: ["read", "bash"],
        model: "claude-sonnet-4-5",
        cwd: "/tmp/ws",
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "delegated-spec",
      result: {
        agentId: "build",
        role: "build",
      },
    });

    expect(localSpecManager.createDynamic).toHaveBeenCalledOnce();
    expect(specManagerCall).toEqual({
      role: "build",
      systemPrompt: "You are a builder agent",
      tools: ["read", "bash"],
      model: "claude-sonnet-4-5",
      cwd: "/tmp/ws",
    });

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

  it("sends error response when await task's executeTask throws and socket remains open", async () => {
    const localAgents = new Map<string, Agent>();
    const localSupervisor = createMockSupervisor(localAgents);
    const localServer = new ParentSocketServer(
      localSupervisor,
      makeMockPi(),
      createMockSpecManager(),
    );
    const localPath = await localServer.start();

    const client = connect(localPath);

    // Spawn
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "err-1",
      params: {
        role: "failing",
        systemPrompt: "failing agent",
        tools: ["read"],
      },
    });
    await readResponse(client);

    // Make executeTask throw
    const agent = localAgents.get("failing") as SubprocessAgent;
    vi.mocked(agent.executeTask).mockRejectedValue(new Error("simulated task failure"));

    // Send task with await: true
    await sendJson(client, {
      type: "send_task",
      correlationId: "err-2",
      params: {
        agentId: "failing",
        prompt: "do work",
        await: true,
      },
    });

    const errorResponse = await readResponse(client);
    expect(errorResponse).toEqual({
      type: "error",
      correlationId: "err-2",
      error: "simulated task failure",
    });

    client.end();
    await localServer.stop();
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

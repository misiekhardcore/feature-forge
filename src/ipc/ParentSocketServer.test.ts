import { connect, type Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../agents/agents";
import { AgentStatus } from "../agents/base";
import { SpecLoader } from "../agents/declarative-specs/SpecLoader";
import { DynamicAgentSpecification, SpecRegistry } from "../agents/specifications";
import { TOOL_PRESETS } from "../agents/specifications/constants";
import { fillTemplate } from "../agents/specifications/templates";
import { SpecManager } from "../agents/SpecManager";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi, makeMockSpecManager } from "../test-utils";
import { ParentSocketServer } from "./ParentSocketServer";

function createMockAgent(): Agent {
  const id = "test-agent";
  return {
    id,
    specification: {
      role: "test",
      systemPrompt: "",
      toolNames: ["read"],
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
  };
}

function createMockSupervisor(agents: Map<string, Agent> = new Map()): AgentSupervisor {
  return {
    spawn: vi.fn().mockImplementation(async (specification) => {
      const agent = createMockAgent();
      const id = specification.role;
      Object.defineProperty(agent, "id", { value: id });
      Object.defineProperty(agent, "specification", { value: specification });
      agents.set(id, agent);
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
    server = new ParentSocketServer(supervisor, makeMockPi(), makeMockSpecManager());
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
      result: { agentId: "worker", role: "worker" },
    });

    // Send task
    await sendJson(client, {
      type: "send_task",
      correlationId: "s2",
      params: {
        agentId: "worker",
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

  it("handles send_task with await=false (fire and forget)", async () => {
    const client = connect(socketPath);

    // Spawn
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "f1",
      params: {
        role: "fireworker",
        systemPrompt: "You are a fire-and-forget worker",
        toolNames: ["read"],
      },
    });

    await readResponse(client);

    // Send task with await: false
    await sendJson(client, {
      type: "send_task",
      correlationId: "f2",
      params: {
        agentId: "fireworker",
        task: "Background work",
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
        toolNames: ["read"],
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

  it("spawns an agent using a named spec from SpecManager", async () => {
    const localSupervisor = createMockSupervisor();
    const registry = new SpecRegistry();
    registry.register(
      "build",
      (params) =>
        new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: fillTemplate("Task: {{TASK}}\nWorkspace: {{WORKSPACE}}", params),
          toolNames: [...TOOL_PRESETS.fullAccess],
          ephemeral: true,
        }),
    );
    const specManager = new SpecManager(registry, new SpecLoader("/nonexistent"));
    const regServer = new ParentSocketServer(localSupervisor, makeMockPi(), specManager);
    const regSocketPath = await regServer.start();

    const client = connect(regSocketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "spec-test",
      params: {
        role: "build",
        systemPrompt: "",
        toolNames: ["read"],
        spec: "build",
        specParams: { TASK: "Add auth", WORKSPACE: "/tmp/ws" },
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "spec-test",
      result: {
        agentId: "build",
        role: "build",
      },
    });

    // Verify the supervisor received a spec with filled template
    expect(localSupervisor.spawn).toHaveBeenCalledOnce();
    const calledSpec = vi.mocked(localSupervisor.spawn).mock.calls[0][0];
    expect(calledSpec.role).toBe("build");
    expect(calledSpec.systemPrompt).toContain("Add auth");
    expect(calledSpec.systemPrompt).not.toContain("{{TASK}}");
    expect(calledSpec.systemPrompt).toContain("/tmp/ws");
    expect(calledSpec.systemPrompt).not.toContain("{{WORKSPACE}}");

    client.end();
    await regServer.stop();
  });

  it("falls back to DynamicAgentSpecification when spec is not provided", async () => {
    const localSupervisor = createMockSupervisor();
    const specRegistry = new SpecRegistry();
    const specManager = new SpecManager(specRegistry, new SpecLoader("/nonexistent"));
    const regServer = new ParentSocketServer(localSupervisor, makeMockPi(), specManager);
    const regSocketPath = await regServer.start();

    const client = connect(regSocketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "fallback-test",
      params: {
        role: "custom",
        systemPrompt: "Custom raw prompt",
        toolNames: ["read"],
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "fallback-test",
      result: {
        agentId: "custom",
        role: "custom",
      },
    });

    // Verify raw systemPrompt was used, not template-driven
    const calledSpec = vi.mocked(localSupervisor.spawn).mock.calls[0][0];
    expect(calledSpec.systemPrompt).toBe("Custom raw prompt");

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

import { connect, type Socket } from "node:net";

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentStatus, jsonParse } from "@feature-forge/core";
import type { Agent } from "@feature-forge/core/src/agents";
import type { AgentSpecificationParams } from "@feature-forge/core/src/agents";
import { AgentSpecification } from "@feature-forge/core/src/agents";
import type { SubprocessAgent } from "@feature-forge/core/src/agents/SubprocessAgent";
import type { AgentSupervisor } from "@feature-forge/core/src/agents/supervisors";
import { makeMockPi, makeMockSpecManager } from "@feature-forge/core/src/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ParentSocketServer } from "./ParentSocketServer";

function createMockAgent(): SubprocessAgent {
  const id = "test-agent";
  return {
    id,
    kind: "subprocess",
    specification: {
      role: "test",
      systemPrompt: "",
      toolRestrictions: { read: [] },
      id,
    } as never,
    status: AgentStatus.Running,
    createdAt: new Date(),
    executeTask: vi.fn().mockResolvedValue("task result"),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue("task result"),
    getError: vi.fn().mockReturnValue(undefined),
    retry: vi.fn().mockResolvedValue("retry result"),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
    start: vi.fn(),
  };
}

function createMockInSessionAgent(overrides: { status?: AgentStatus } = {}): Agent {
  return {
    kind: "in-session",
    id: "session-agent",
    specification: {
      role: "session",
      systemPrompt: "",
      toolRestrictions: { read: [] },
      id: "session-agent",
    } as never,
    status: overrides.status ?? AgentStatus.Running,
    createdAt: new Date(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

let specManagerCall: AgentSpecificationParams | null = null;

function createMockSpecManager() {
  specManagerCall = null;
  const manager = makeMockSpecManager();
  manager.createDynamic = vi.fn().mockImplementation((params: AgentSpecificationParams) => {
    specManagerCall = params;
    const toolRestrictions = params.toolRestrictions ?? {};
    return {
      id: params.role,
      role: params.role,
      systemPrompt: params.systemPrompt,
      toolRestrictions,
      get tools() {
        return Object.keys(toolRestrictions);
      },
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
      resolve(jsonParse(lines[0]));
    };
    socket.once("data", handler);
  });
}

/**
 * Read `count` newline-delimited JSON messages from the socket, buffering
 * partial chunks so messages split across (or bundled into) chunks are
 * still captured.
 */
function readMessages(socket: Socket, count = 1, timeout = 2000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Response timeout"));
    }, timeout);
    let buffer = "";
    const messages: unknown[] = [];
    const handler = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          messages.push(jsonParse(trimmed));
        }
      }
      if (messages.length >= count) {
        clearTimeout(timer);
        socket.removeListener("data", handler);
        resolve(messages.slice(0, count));
      }
    };
    socket.on("data", handler);
  });
}

describe("ParentSocketServer", () => {
  let server: ParentSocketServer;
  let supervisor: AgentSupervisor;
  let pi: ExtensionAPI;
  let socketPath: string;

  beforeEach(async () => {
    supervisor = createMockSupervisor();
    pi = makeMockPi();
    server = new ParentSocketServer(supervisor, pi, createMockSpecManager());
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
        toolRestrictions: { read: [], grep: [] },
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

  it("executes the spawn prompt in the background and pushes completion", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "spawn-prompt-1",
      params: {
        role: "prompt-worker",
        systemPrompt: "You are a prompt worker",
        toolRestrictions: { read: [] },
        prompt: "Do the initial work",
      },
    });

    const [response, push] = await readMessages(client, 2);
    expect(response).toEqual({
      type: "result",
      correlationId: "spawn-prompt-1",
      result: {
        agentId: "prompt-worker",
        role: "prompt-worker",
      },
    });
    expect(push).toEqual({
      type: "agent_update",
      payload: {
        agentId: "prompt-worker",
        status: AgentStatus.Completed,
        result: "task result",
      },
    });

    const agent = supervisor.getAgent("prompt-worker") as SubprocessAgent;
    expect(agent.executeTask).toHaveBeenCalledOnce();
    expect(agent.executeTask).toHaveBeenCalledWith(
      "Do the initial work",
      expect.objectContaining({ timeout: undefined }),
    );

    client.end();
  });

  it("emits agent-started and agent-done events for the spawn prompt", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "spawn-prompt-2",
      params: {
        role: "prompt-events",
        systemPrompt: "You are a prompt events worker",
        toolRestrictions: { read: [] },
        prompt: "Do the initial work",
      },
    });

    await readMessages(client, 2);

    const emitSpy = pi.events as unknown as { emit: ReturnType<typeof vi.fn> };
    expect(emitSpy.emit).toHaveBeenCalledWith(
      "feature-forge:agent-started",
      expect.objectContaining({
        phase: "agent-started",
        details: expect.objectContaining({
          executionId: "spawn-prompt-2:spawn-prompt",
          agentId: "prompt-events",
        }),
      }),
    );
    expect(emitSpy.emit).toHaveBeenCalledWith(
      "feature-forge:agent-done",
      expect.objectContaining({
        phase: "agent-done",
        details: expect.objectContaining({
          executionId: "spawn-prompt-2:spawn-prompt",
          agentId: "prompt-events",
          passed: true,
          summary: "task result",
        }),
      }),
    );

    client.end();
  });

  it("pushes a failed update when the spawn prompt execution fails", async () => {
    const localAgents = new Map<string, Agent>();
    const localSupervisor = createMockSupervisor(localAgents);
    // Pre-configure the spawned agent to fail its initial task.
    localSupervisor.spawnGuest = vi
      .fn()
      .mockImplementation(async (specification: AgentSpecification) => {
        const agent = createMockAgent();
        Object.defineProperty(agent, "id", { value: specification.role });
        Object.defineProperty(agent, "specification", { value: specification });
        vi.mocked(agent.executeTask).mockRejectedValue(new Error("initial prompt failure"));
        localAgents.set(specification.role, agent);
        return agent;
      });
    const localPi = makeMockPi();
    const localServer = new ParentSocketServer(localSupervisor, localPi, createMockSpecManager());
    const localPath = await localServer.start();

    const client = connect(localPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "spawn-prompt-3",
      params: {
        role: "prompt-fail",
        systemPrompt: "You are a failing prompt worker",
        toolRestrictions: { read: [] },
        prompt: "Do the initial work",
      },
    });

    const [response, push] = await readMessages(client, 2);
    expect(response).toEqual({
      type: "result",
      correlationId: "spawn-prompt-3",
      result: { agentId: "prompt-fail", role: "prompt-fail" },
    });
    expect(push).toEqual({
      type: "agent_update",
      payload: {
        agentId: "prompt-fail",
        status: AgentStatus.Failed,
        result: "initial prompt failure",
      },
    });

    const emitSpy = localPi.events as unknown as { emit: ReturnType<typeof vi.fn> };
    expect(emitSpy.emit).toHaveBeenCalledWith(
      "feature-forge:agent-done",
      expect.objectContaining({
        phase: "agent-done",
        details: expect.objectContaining({
          agentId: "prompt-fail",
          passed: false,
          summary: "initial prompt failure",
        }),
      }),
    );

    client.end();
    await localServer.stop();
  });

  it("does not execute any task when spawned without a prompt", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "spawn-idle-1",
      params: {
        role: "idle-worker",
        systemPrompt: "You are an idle worker",
        toolRestrictions: { read: [] },
      },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "spawn-idle-1",
      result: {
        agentId: "idle-worker",
        role: "idle-worker",
      },
    });

    await Promise.resolve();
    const agent = supervisor.getAgent("idle-worker") as SubprocessAgent;
    expect(agent.executeTask).not.toHaveBeenCalled();

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
        toolRestrictions: { read: [] },
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
        toolRestrictions: { read: [] },
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

  it("excludes in-session agents from list_agents", async () => {
    const localAgents = new Map<string, Agent>();
    localAgents.set("session-agent", createMockInSessionAgent());
    const localSupervisor = createMockSupervisor(localAgents);
    const localServer = new ParentSocketServer(
      localSupervisor,
      makeMockPi(),
      createMockSpecManager(),
    );
    const localPath = await localServer.start();

    const client = connect(localPath);

    // Spawn a subprocess sibling alongside the pre-seeded in-session persona.
    await sendJson(client, {
      type: "spawn_agent",
      correlationId: "l1",
      params: { role: "sub-worker", systemPrompt: "sub", toolRestrictions: { read: [] } },
    });
    await readResponse(client);

    await sendJson(client, {
      type: "list_agents",
      correlationId: "l2",
      params: {},
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "result",
      correlationId: "l2",
      result: {
        agents: [{ agentId: "sub-worker", role: "sub-worker", status: AgentStatus.Running }],
      },
    });

    client.end();
    await localServer.stop();
  });

  it("refuses to destroy an in-session agent", async () => {
    const localAgents = new Map<string, Agent>();
    const sessionAgent = createMockInSessionAgent();
    localAgents.set("session-agent", sessionAgent);
    const localSupervisor = createMockSupervisor(localAgents);
    const localServer = new ParentSocketServer(
      localSupervisor,
      makeMockPi(),
      createMockSpecManager(),
    );
    const localPath = await localServer.start();

    const client = connect(localPath);

    await sendJson(client, {
      type: "destroy_agent",
      correlationId: "da-1",
      params: { agentId: "session-agent" },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "error",
      correlationId: "da-1",
      error: "Agent not a subprocess agent: session-agent",
    });
    expect(localSupervisor.destroyAgent).not.toHaveBeenCalled();
    expect(localAgents.has("session-agent")).toBe(true);
    expect(sessionAgent.destroy).not.toHaveBeenCalled();

    client.end();
    await localServer.stop();
  });

  it("responds with an error when destroying an unknown agent", async () => {
    const client = connect(socketPath);

    await sendJson(client, {
      type: "destroy_agent",
      correlationId: "da-2",
      params: { agentId: "non-existent" },
    });

    const response = await readResponse(client);
    expect(response).toEqual({
      type: "error",
      correlationId: "da-2",
      error: "Agent not found: non-existent",
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
        toolRestrictions: { read: [] },
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
        toolRestrictions: { read: [], bash: [] },
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
      toolRestrictions: { read: [], bash: [] },
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
        toolRestrictions: { read: [] },
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

  describe("event bus emissions", () => {
    it("emits feature-forge:agent-started and feature-forge:agent-done on await=true success", async () => {
      const client = connect(socketPath);

      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "evt-1",
        params: { role: "event-worker", systemPrompt: "event worker", tools: ["read"] },
      });
      await readResponse(client);

      await sendJson(client, {
        type: "send_task",
        correlationId: "evt-2",
        params: { agentId: "event-worker", prompt: "do work", await: true },
      });
      await readResponse(client);

      const emitSpy = pi.events as unknown as { emit: ReturnType<typeof vi.fn> };
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-started",
        expect.objectContaining({
          phase: "agent-started",
          details: expect.objectContaining({ agentId: "event-worker" }),
        }),
      );
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-done",
        expect.objectContaining({
          phase: "agent-done",
          details: expect.objectContaining({
            agentId: "event-worker",
            passed: true,
            summary: "task result",
          }),
        }),
      );

      client.end();
    });

    it("emits feature-forge:agent-done with passed=false on await=true failure", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localPi = makeMockPi();
      const localServer = new ParentSocketServer(localSupervisor, localPi, createMockSpecManager());
      const localPath = await localServer.start();

      const client = connect(localPath);

      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "fail-1",
        params: { role: "fail-worker", systemPrompt: "fail", tools: ["read"] },
      });
      await readResponse(client);

      const agent = localAgents.get("fail-worker") as SubprocessAgent;
      vi.mocked(agent.executeTask).mockRejectedValue(new Error("task error"));

      await sendJson(client, {
        type: "send_task",
        correlationId: "fail-2",
        params: { agentId: "fail-worker", prompt: "work", await: true },
      });
      await readResponse(client);

      const emitSpy = localPi.events as unknown as { emit: ReturnType<typeof vi.fn> };
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-started",
        expect.objectContaining({
          phase: "agent-started",
          details: expect.objectContaining({ agentId: "fail-worker" }),
        }),
      );
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-done",
        expect.objectContaining({
          phase: "agent-done",
          details: expect.objectContaining({
            agentId: "fail-worker",
            passed: false,
            summary: "task error",
          }),
        }),
      );

      client.end();
      await localServer.stop();
    });

    it("emits feature-forge:agent-done on await=false success", async () => {
      const client = connect(socketPath);

      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "ffs-1",
        params: { role: "ff-worker", systemPrompt: "ff", tools: ["read"] },
      });
      await readResponse(client);

      await sendJson(client, {
        type: "send_task",
        correlationId: "ffs-2",
        params: { agentId: "ff-worker", prompt: "background work", await: false },
      });
      await readResponse(client);

      // Flush microtasks so the .then() callback runs
      await Promise.resolve();

      const emitSpy = pi.events as unknown as { emit: ReturnType<typeof vi.fn> };
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-started",
        expect.objectContaining({
          phase: "agent-started",
          details: expect.objectContaining({ agentId: "ff-worker" }),
        }),
      );
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-done",
        expect.objectContaining({
          phase: "agent-done",
          details: expect.objectContaining({
            agentId: "ff-worker",
            passed: true,
            summary: "task result",
          }),
        }),
      );

      client.end();
    });

    it("emits feature-forge:agent-done with passed=false on await=false failure", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localPi = makeMockPi();
      const localServer = new ParentSocketServer(localSupervisor, localPi, createMockSpecManager());
      const localPath = await localServer.start();

      const client = connect(localPath);

      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "fff-1",
        params: { role: "fff-worker", systemPrompt: "fff", tools: ["read"] },
      });
      await readResponse(client);

      const agent = localAgents.get("fff-worker") as SubprocessAgent;
      vi.mocked(agent.executeTask).mockRejectedValue(new Error("background failure"));

      await sendJson(client, {
        type: "send_task",
        correlationId: "fff-2",
        params: { agentId: "fff-worker", prompt: "bg work", await: false },
      });
      await readResponse(client);

      // Flush microtasks so the .catch() callback runs
      await Promise.resolve();

      const emitSpy = localPi.events as unknown as { emit: ReturnType<typeof vi.fn> };
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-started",
        expect.objectContaining({
          phase: "agent-started",
          details: expect.objectContaining({ agentId: "fff-worker" }),
        }),
      );
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-done",
        expect.objectContaining({
          phase: "agent-done",
          details: expect.objectContaining({
            agentId: "fff-worker",
            passed: false,
            summary: "background failure",
          }),
        }),
      );

      client.end();
      await localServer.stop();
    });

    it("emits feature-forge:agent-stream events with phase, message, executionId, label, and event fields", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localPi = makeMockPi();
      const localServer = new ParentSocketServer(localSupervisor, localPi, createMockSpecManager());
      const localPath = await localServer.start();

      const client = connect(localPath);

      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "str-1",
        params: { role: "stream-worker", systemPrompt: "stream", tools: ["read"] },
      });
      await readResponse(client);

      const agent = localAgents.get("stream-worker") as SubprocessAgent;
      vi.mocked(agent.executeTask).mockImplementation(async (_prompt, options) => {
        const streamEvent: JsonAgentSessionEvent = {
          type: "tool_execution_start",
          toolCallId: "tc-1",
          toolName: "read",
          args: {},
        };
        options?.onEvent?.(streamEvent);
        return "stream result";
      });

      await sendJson(client, {
        type: "send_task",
        correlationId: "str-2",
        params: { agentId: "stream-worker", prompt: "stream work", await: true },
      });
      await readResponse(client);

      const emitSpy = localPi.events as unknown as { emit: ReturnType<typeof vi.fn> };
      expect(emitSpy.emit).toHaveBeenCalledWith(
        "feature-forge:agent-stream",
        expect.objectContaining({
          phase: "agent-stream",
          message: expect.stringContaining('Agent "stream-worker" stream event'),
          details: expect.objectContaining({
            executionId: "str-2",
            agentId: "stream-worker",
            label: "stream-worker",
            event: {
              type: "tool_execution_start",
              toolCallId: "tc-1",
              toolName: "read",
              args: {},
            },
          }),
        }),
      );

      client.end();
      await localServer.stop();
    });
  });

  describe("lifecycle and edge paths", () => {
    it("stop() on a never-started server is a no-op", async () => {
      const localServer = new ParentSocketServer(
        createMockSupervisor(),
        makeMockPi(),
        createMockSpecManager(),
      );
      await expect(localServer.stop()).resolves.toBeUndefined();
      expect(localServer.path).toBeNull();
    });

    it("stop() can be called twice (second call is a no-op)", async () => {
      const localServer = new ParentSocketServer(
        createMockSupervisor(),
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();
      expect(localServer.path).toBe(localPath);

      await localServer.stop();
      expect(localServer.path).toBeNull();
      await expect(localServer.stop()).resolves.toBeUndefined();
    });

    it("session_shutdown stops the server", async () => {
      const localPi = makeMockPi();
      const localServer = new ParentSocketServer(
        createMockSupervisor(),
        localPi,
        createMockSpecManager(),
      );
      const localPath = await localServer.start();
      expect(localServer.path).toBe(localPath);

      const shutdownHandler = (localPi.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === "session_shutdown",
      )?.[1] as () => Promise<void>;
      expect(shutdownHandler).toBeDefined();
      await shutdownHandler();

      expect(localServer.path).toBeNull();
    });

    it("destroys the agent when the client disconnects mid-await", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "dc-1",
        params: { role: "hanging", systemPrompt: "hangs forever", toolRestrictions: {} },
      });
      await readResponse(client);

      const agent = localAgents.get("hanging") as SubprocessAgent;
      vi.mocked(agent.executeTask).mockReturnValue(new Promise(() => {}));

      await sendJson(client, {
        type: "send_task",
        correlationId: "dc-2",
        params: { agentId: "hanging", prompt: "never finishes", await: true },
      });

      // Give the server a tick to register the close listener, then drop
      // the connection — the pending await must destroy the agent.
      await new Promise((resolve) => setTimeout(resolve, 20));
      client.destroy();
      await vi.waitFor(() => {
        expect(localSupervisor.destroyAgent).toHaveBeenCalledWith("hanging");
      });

      await localServer.stop();
    });

    it("refuses send_task for an in-session agent", async () => {
      const localAgents = new Map<string, Agent>();
      localAgents.set("session-agent", createMockInSessionAgent());
      const localSupervisor = createMockSupervisor(localAgents);
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "send_task",
        correlationId: "st-1",
        params: { agentId: "session-agent", prompt: "x", await: false },
      });

      const response = await readResponse(client);
      expect(response).toEqual({
        type: "error",
        correlationId: "st-1",
        error: "Agent not a subprocess agent: session-agent",
      });

      client.end();
      await localServer.stop();
    });

    it("responds with an error for an unknown get_agent_result agent", async () => {
      const client = connect(socketPath);
      await sendJson(client, {
        type: "get_agent_result",
        correlationId: "gr-1",
        params: { agentId: "non-existent" },
      });

      const response = await readResponse(client);
      expect(response).toEqual({
        type: "error",
        correlationId: "gr-1",
        error: "Agent not found: non-existent",
      });
      client.end();
    });

    it("returns the result for a completed subprocess agent via get_agent_result", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "gr-2",
        params: { role: "done-worker", systemPrompt: "done", toolRestrictions: {} },
      });
      await readResponse(client);

      const agent = localAgents.get("done-worker") as SubprocessAgent;
      (agent as { status: AgentStatus }).status = AgentStatus.Completed;

      await sendJson(client, {
        type: "get_agent_result",
        correlationId: "gr-3",
        params: { agentId: "done-worker" },
      });

      const response = await readResponse(client);
      expect(response).toEqual({
        type: "result",
        correlationId: "gr-3",
        result: { status: "Completed", result: "task result" },
      });

      client.end();
      await localServer.stop();
    });

    it("returns a null result for a completed in-session agent via get_agent_result", async () => {
      const localAgents = new Map<string, Agent>();
      localAgents.set("session-agent", createMockInSessionAgent({ status: AgentStatus.Completed }));
      const localSupervisor = createMockSupervisor(localAgents);
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "get_agent_result",
        correlationId: "gr-4",
        params: { agentId: "session-agent" },
      });

      const response = await readResponse(client);
      expect(response).toEqual({
        type: "result",
        correlationId: "gr-4",
        result: { status: "Completed", result: null },
      });

      client.end();
      await localServer.stop();
    });

    it("ignores unknown message types", async () => {
      const client = connect(socketPath);
      const received: Buffer[] = [];
      client.on("data", (chunk: Buffer) => received.push(chunk));
      client.write(JSON.stringify({ type: "mystery_message", correlationId: "u-1" }) + "\n");
      // No response expected — give the server a tick and assert nothing arrived.
      await new Promise((resolve) => setTimeout(resolve, 50));
      client.end();
      expect(received).toEqual([]);
    });

    it("sends an error response when a message handler throws", async () => {
      const localSupervisor = createMockSupervisor();
      const throwingSpecManager = createMockSpecManager();
      throwingSpecManager.createDynamic = vi.fn().mockImplementation(() => {
        throw new Error("spec boom");
      });
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        throwingSpecManager,
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "th-1",
        params: { role: "x", systemPrompt: "x", toolRestrictions: {} },
      });

      const response = await readResponse(client);
      expect(response).toEqual({
        type: "error",
        correlationId: "th-1",
        error: "spec boom",
      });

      client.end();
      await localServer.stop();
    });

    it("skips the error response when the client disconnects before the failure lands", async () => {
      const localAgents = new Map<string, Agent>();
      const localSupervisor = createMockSupervisor(localAgents);
      const localServer = new ParentSocketServer(
        localSupervisor,
        makeMockPi(),
        createMockSpecManager(),
      );
      const localPath = await localServer.start();

      const client = connect(localPath);
      await sendJson(client, {
        type: "spawn_agent",
        correlationId: "sd-1",
        params: { role: "late-fail", systemPrompt: "x", toolRestrictions: {} },
      });
      await readResponse(client);

      const agent = localAgents.get("late-fail") as SubprocessAgent;
      vi.mocked(agent.executeTask).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late failure")), 60);
          }),
      );

      await sendJson(client, {
        type: "send_task",
        correlationId: "sd-2",
        params: { agentId: "late-fail", prompt: "work", await: true },
      });

      // Drop the connection before the task fails — the failure must be
      // swallowed (socketClosed) and the agent destroyed.
      await new Promise((resolve) => setTimeout(resolve, 10));
      client.destroy();
      await vi.waitFor(() => {
        expect(localSupervisor.destroyAgent).toHaveBeenCalledWith("late-fail");
      });

      await localServer.stop();
    });
  });
});

import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecification } from "../agents";
import type { Agent } from "../agents/agents";
import { AgentStatus } from "../agents/base";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi } from "../test-utils";
import { ChildSocketClient } from "./ChildSocketClient";
import { IpcConnectionError, IpcRequestError, IpcTimeoutError } from "./errors";
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

function createMockSupervisor(): AgentSupervisor {
  const agents = new Map<string, Agent>();
  return {
    spawn: vi.fn().mockImplementation((specification: AgentSpecification) => {
      const agent = createMockAgent();
      const id = specification.id;
      Object.defineProperty(agent, "id", { value: id });
      agents.set(id, agent);
      return agent;
    }),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation((id: string) => agents.delete(id)),
    destroyAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ChildSocketClient with real ParentSocketServer", () => {
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

  it("connects, sends a spawn_agent request, and receives a response", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    const result = await client.request("spawn_agent", {
      role: "researcher",
      systemPrompt: "You are a researcher",
      toolNames: ["read", "grep"],
    });

    expect(result).toEqual({
      agentId: "researcher",
      role: "researcher",
    });

    await client.disconnect();
  });

  it("sends a list_agents request and receives an empty list", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    const result = await client.request("list_agents", {});

    expect(result).toEqual({ agents: [] });

    await client.disconnect();
  });

  it("sends a send_task request with await=true and receives the result", async () => {
    const client = new ChildSocketClient(socketPath);

    // First spawn an agent
    await client.connect();
    await client.request("spawn_agent", {
      role: "worker",
      systemPrompt: "You are a worker",
      toolNames: ["read"],
    });

    // Send a task
    const result = await client.request("send_task", {
      agentId: "worker",
      task: "Do the work",
      await: true,
    });

    expect(result).toEqual({ result: "task result" });

    await client.disconnect();
  });

  it("receives an error response for a non-existent agent", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    await expect(
      client.request("send_task", {
        agentId: "non-existent",
        task: "do something",
        await: true,
      }),
    ).rejects.toThrow(IpcRequestError);

    await client.disconnect();
  });

  it("sends a destroy_agent request and receives success", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    // Spawn first
    await client.request("spawn_agent", {
      role: "temp",
      systemPrompt: "temp",
      toolNames: ["read"],
    });

    // Destroy
    const result = await client.request("destroy_agent", {
      agentId: "temp",
    });

    expect(result).toEqual({ status: "destroyed" });

    await client.disconnect();
  });

  it("receives push events via onPush handler", async () => {
    const client = new ChildSocketClient(socketPath);
    const pushEvents: unknown[] = [];

    client.onPush((event) => {
      pushEvents.push(event);
    });

    await client.connect();

    // Spawn an agent
    await client.request("spawn_agent", {
      role: "pusher",
      systemPrompt: "pusher",
      toolNames: ["read"],
    });

    // Fire a non-awaited task (this triggers pushAgentUpdate)
    await client.request("send_task", {
      agentId: "pusher",
      task: "background work",
      await: false,
    });

    // Wait a tick for the push to arrive
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(pushEvents.length).toBeGreaterThanOrEqual(1);
    expect(pushEvents[0]).toHaveProperty("type", "agent_update");
    expect(pushEvents[0]).toHaveProperty("payload");

    await client.disconnect();
  });
});

describe("ChildSocketClient error handling", () => {
  it("throws IpcConnectionError when connecting to a non-existent socket", async () => {
    const client = new ChildSocketClient("/tmp/non-existent-socket.sock");

    await expect(client.connect()).rejects.toThrow(IpcConnectionError);
  });

  it("throws IpcTimeoutError when request times out", async () => {
    // Create a server that accepts connections but never responds
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-test-"));
    const timeoutPath = join(tempDir, "timeout.sock");

    const silentServer = createServer(() => {
      // Accept but never write — client will time out
    });

    await new Promise<void>((resolve) => {
      silentServer.listen(timeoutPath, resolve);
    });

    const client = new ChildSocketClient(timeoutPath);
    await client.connect();

    // Request with very short timeout
    await expect(
      client.request("spawn_agent", { role: "x", systemPrompt: "x", toolNames: [] }, 100),
    ).rejects.toThrow(IpcTimeoutError);

    silentServer.close();
  });
});

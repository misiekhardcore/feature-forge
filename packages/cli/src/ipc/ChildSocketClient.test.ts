import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentStatus, jsonParse } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSpecification } from "../agents";
import type { Agent } from "../agents/agents";
import type { SubprocessAgent } from "../agents/agents/SubprocessAgent";
import type { AgentSupervisor } from "../agents/supervisors";
import { makeMockPi, makeMockSpecManager } from "../test-utils";
import { ChildSocketClient } from "./ChildSocketClient";
import { IpcConnectionError, IpcRequestError, IpcTimeoutError } from "./errors";
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

function createMockSupervisor(): AgentSupervisor {
  const agents = new Map<string, Agent>();
  return {
    spawnGuest: vi.fn().mockImplementation((specification: AgentSpecification) => {
      const agent = createMockAgent();
      const id = specification.id;
      Object.defineProperty(agent, "id", { value: id });
      Object.defineProperty(agent, "specification", { value: specification });
      agents.set(id, agent);
      return agent;
    }),
    mountInSession: vi.fn().mockResolvedValue(undefined),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation((id: string) => agents.delete(id)),
  };
}

describe("ChildSocketClient with real ParentSocketServer", () => {
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

  it("connects, sends a spawn_agent request, and receives a response", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    const result = await client.request("spawn_agent", {
      role: "researcher",
      systemPrompt: "You are a researcher",
      toolRestrictions: { read: [], grep: [] },
    });

    expect(result).toMatchObject({
      agentId: expect.stringContaining("researcher"),
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
    const spawnResult = await client.request("spawn_agent", {
      role: "worker",
      systemPrompt: "You are a worker",
      toolRestrictions: { read: [] },
    });

    // Send a task using the actual agentId from spawn
    const result = await client.request("send_task", {
      agentId: spawnResult.agentId,
      prompt: "Do the work",
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
        prompt: "do something",
        await: true,
      }),
    ).rejects.toThrow(IpcRequestError);

    await client.disconnect();
  });

  it("sends a destroy_agent request and receives success", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    // Spawn first
    const spawnResult = await client.request("spawn_agent", {
      role: "temp",
      systemPrompt: "temp",
      toolRestrictions: { read: [] },
    });

    // Destroy using the actual agentId from spawn
    const result = await client.request("destroy_agent", {
      agentId: spawnResult.agentId,
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
    const spawnResult = await client.request("spawn_agent", {
      role: "pusher",
      systemPrompt: "pusher",
      toolRestrictions: { read: [] },
    });

    // Fire a non-awaited task (this triggers pushAgentUpdate)
    await client.request("send_task", {
      agentId: spawnResult.agentId,
      prompt: "background work",
      await: false,
    });

    // Wait a tick for the push to arrive
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(pushEvents.length).toBeGreaterThanOrEqual(1);
    expect(pushEvents[0]).toHaveProperty("type", "agent_update");
    expect(pushEvents[0]).toHaveProperty("payload");

    await client.disconnect();
  });

  it("completes normally when signal is present but not aborted", async () => {
    const client = new ChildSocketClient(socketPath);
    await client.connect();

    const controller = new AbortController();
    const result = await client.request("list_agents", {}, undefined, controller.signal);

    expect(result).toEqual({ agents: [] });

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
      client.request("spawn_agent", { role: "x", systemPrompt: "x", toolRestrictions: {} }, 100),
    ).rejects.toThrow(IpcTimeoutError);

    silentServer.close();
  });

  it("aborts a pending request when signal is fired", async () => {
    // Create a server that accepts connections but never responds
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-test-"));
    const abortPath = join(tempDir, "abort.sock");

    const silentServer = createServer(() => {
      // Accept but never write — request will be aborted
    });

    await new Promise<void>((resolve) => {
      silentServer.listen(abortPath, resolve);
    });

    const client = new ChildSocketClient(abortPath);
    await client.connect();

    const controller = new AbortController();

    // Start a request that won't receive a response
    const requestPromise = client.request(
      "spawn_agent",
      { role: "x", systemPrompt: "x", toolRestrictions: {} },
      60_000,
      controller.signal,
    );

    // Abort immediately
    controller.abort();

    await expect(requestPromise).rejects.toThrow(DOMException);
    await expect(requestPromise).rejects.toThrow("The operation was aborted");

    silentServer.close();
  });

  it("disconnect before connect is a no-op", async () => {
    const client = new ChildSocketClient("/tmp/never-connected.sock");
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it("request without a connection rejects immediately instead of waiting out the timeout", async () => {
    const client = new ChildSocketClient("/tmp/never-connected.sock");
    await expect(client.request("list_agents", {})).rejects.toThrow(IpcConnectionError);
  });

  it("rejects pending requests when the connection closes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-test-"));
    const closePath = join(tempDir, "close.sock");

    let serverSocket: import("node:net").Socket | undefined;
    const rawServer = createServer((socket) => {
      serverSocket = socket;
    });
    await new Promise<void>((resolve) => {
      rawServer.listen(closePath, resolve);
    });

    const client = new ChildSocketClient(closePath);
    await client.connect();

    // A request that will never get a response while the transport is up.
    const requestPromise = client.request(
      "spawn_agent",
      { role: "x", systemPrompt: "x", toolRestrictions: {} },
      2_000,
    );

    await vi.waitFor(() => {
      expect(serverSocket).toBeDefined();
    });
    serverSocket!.destroy();

    // Must fail fast with a connection error, not after the 2s timeout.
    await expect(requestPromise).rejects.toThrow(IpcConnectionError);

    await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  });

  it("rejects pending requests when an error occurs after connection", async () => {
    // Error events after connection must reject pending requests even if no
    // close event follows (error-first ordering must not leak them into the
    // timeout). A raw-server test cannot pin this path: an abrupt server
    // teardown always emits both error and close, so the close handler alone
    // would pass it. The mock emits only "error".
    vi.resetModules();
    const connectMock = vi.fn();
    vi.doMock("node:net", async () => {
      const actual = await vi.importActual<typeof import("node:net")>("node:net");
      return { ...actual, connect: connectMock };
    });

    const { ChildSocketClient: MockedChildSocketClient } = await import("./ChildSocketClient");

    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const fakeSocket = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return fakeSocket;
      }),
      write: vi.fn(),
      setTimeout: vi.fn(),
      end: vi.fn(),
    };
    connectMock.mockImplementation((_path: string, onConnect: () => void) => {
      setTimeout(onConnect, 0);
      return fakeSocket;
    });

    const client = new MockedChildSocketClient("/tmp/fake-error.sock");
    await client.connect();

    // A request that will never get a response while the transport is up.
    const requestPromise = client.request(
      "spawn_agent",
      { role: "x", systemPrompt: "x", toolRestrictions: {} },
      2_000,
    );

    const errorHandler = handlers.get("error")?.[0] as (error: Error) => void;
    expect(errorHandler).toBeDefined();
    errorHandler(new Error("socket boom"));

    // Must fail fast with a connection error, not after the 2s timeout.
    // (Assert by name/message: vi.resetModules + dynamic import creates a
    // second IpcConnectionError class, so instanceof against the top-level
    // import fails despite the same shape.)
    await expect(requestPromise).rejects.toMatchObject({
      name: "IpcConnectionError",
      message: "Connection to /tmp/fake-error.sock failed",
    });
  });

  it("guards against double-connect (concurrent and repeated)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-test-"));
    const doublePath = join(tempDir, "double.sock");

    let connections = 0;
    const rawServer = createServer(() => {
      connections += 1;
    });
    await new Promise<void>((resolve) => {
      rawServer.listen(doublePath, resolve);
    });

    const client = new ChildSocketClient(doublePath);
    await Promise.all([client.connect(), client.connect()]);
    await client.connect();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connections).toBe(1);

    await client.disconnect();
    await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  });

  it("ignores a stale close from a superseded connect attempt", async () => {
    // Reconnect after a disconnect: the first socket's late close must not
    // clobber the newer connection (identity guard on the close handler).
    // Without the guard, the stale close would null this.socket and reject
    // the new connection's pending requests, killing the reconnected client.
    vi.resetModules();
    const connectMock = vi.fn();
    vi.doMock("node:net", async () => {
      const actual = await vi.importActual<typeof import("node:net")>("node:net");
      return { ...actual, connect: connectMock };
    });

    const { ChildSocketClient: MockedChildSocketClient } = await import("./ChildSocketClient");

    const makeFakeSocket = () => {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      const fakeSocket = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          const list = handlers.get(event) ?? [];
          list.push(handler);
          handlers.set(event, list);
          return fakeSocket;
        }),
        write: vi.fn((data: string) => {
          const message = jsonParse<{ correlationId: string }>(data);
          const response =
            JSON.stringify({ type: "result", correlationId: message.correlationId, result: "ok" }) +
            "\n";
          for (const handler of handlers.get("data") ?? []) {
            (handler as (chunk: Buffer) => void)(Buffer.from(response));
          }
        }),
        setTimeout: vi.fn(),
        end: vi.fn((callback: () => void) => callback()),
      };
      return { handlers, socket: fakeSocket };
    };

    const first = makeFakeSocket();
    const second = makeFakeSocket();
    let callCount = 0;
    connectMock.mockImplementation((_path: string, onConnect: () => void) => {
      callCount += 1;
      setTimeout(onConnect, 0);
      return callCount === 1 ? first.socket : second.socket;
    });

    const client = new MockedChildSocketClient("/tmp/fake-reconnect.sock");
    await client.connect();
    await client.disconnect();
    await client.connect();

    // Fire the first socket's close handler after the reconnect: must be ignored.
    const staleClose = first.handlers.get("close")?.[0] as () => void;
    expect(staleClose).toBeDefined();
    staleClose();

    // The newer connection must still serve requests (the stale close did
    // not reject its pending entries or drop this.socket).
    await expect(client.request("list_agents", {}, 500)).resolves.toEqual("ok");
    expect(second.socket.write).toHaveBeenCalled();

    // disconnect() must still find the newer socket (the stale close did
    // not null it), so the end callback runs on the second socket.
    await client.disconnect();
    expect(second.socket.end).toHaveBeenCalledTimes(1);
  });

  it("registers the pending entry before writing so an immediate response is not lost", async () => {
    // Replace node:net with a fake whose write() delivers the response
    // synchronously - as if the answer were already in flight when the
    // request was being written. Only a pending entry registered before
    // the write can catch that response; a post-write registration would
    // drop it as stale and the request would hang until the timeout.
    vi.resetModules();
    const connectMock = vi.fn();
    vi.doMock("node:net", async () => {
      const actual = await vi.importActual<typeof import("node:net")>("node:net");
      return { ...actual, connect: connectMock };
    });

    const { ChildSocketClient: MockedChildSocketClient } = await import("./ChildSocketClient");

    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const fakeSocket = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return fakeSocket;
      }),
      write: vi.fn((data: string) => {
        const message = jsonParse<{ correlationId: string }>(data);
        const response =
          JSON.stringify({ type: "result", correlationId: message.correlationId, result: "ok" }) +
          "\n";
        for (const handler of handlers.get("data") ?? []) {
          (handler as (chunk: Buffer) => void)(Buffer.from(response));
        }
      }),
      setTimeout: vi.fn(),
      end: vi.fn(),
    };
    connectMock.mockImplementation((_path: string, onConnect: () => void) => {
      // Real net.connect never calls back synchronously.
      setTimeout(onConnect, 0);
      return fakeSocket;
    });

    const client = new MockedChildSocketClient("/tmp/fake.sock");
    await client.connect();

    await expect(client.request("list_agents", {}, 500)).resolves.toEqual("ok");
  });

  it("skips malformed JSON, ignores stale responses, and resolves matching ones", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "forge-ipc-test-"));
    const rawPath = join(tempDir, "raw.sock");

    const rawServer = createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        const message = jsonParse<{ correlationId: string }>(chunk.toString("utf-8"));
        // Malformed line first (skipped by the client), then a stale response
        // for an unknown correlation id, then the real answer.
        socket.write("this is not json\n");
        socket.write(
          JSON.stringify({ type: "result", correlationId: "stale-correlation", result: "x" }) +
            "\n",
        );
        socket.write(
          JSON.stringify({ type: "result", correlationId: message.correlationId, result: "ok" }) +
            "\n",
        );
      });
    });

    await new Promise<void>((resolve) => {
      rawServer.listen(rawPath, resolve);
    });

    const client = new ChildSocketClient(rawPath);
    await client.connect();

    await expect(client.request("list_agents", {})).resolves.toEqual("ok");

    await client.disconnect();
    await new Promise<void>((resolve) => rawServer.close(() => resolve()));
  });

  it("isolates a throwing push handler", async () => {
    const localServer = new ParentSocketServer(
      createMockSupervisor(),
      makeMockPi(),
      makeMockSpecManager(),
    );
    const localPath = await localServer.start();
    const client = new ChildSocketClient(localPath);
    const seen: unknown[] = [];
    client.onPush(() => {
      throw new Error("handler boom");
    });
    client.onPush((event) => {
      seen.push(event);
    });

    await client.connect();

    // Spawn an agent and fire a non-awaited task to trigger a push.
    const spawnResult = await client.request("spawn_agent", {
      role: "push-thrower",
      systemPrompt: "push-thrower",
      toolRestrictions: { read: [] },
    });
    await client.request("send_task", {
      agentId: spawnResult.agentId,
      prompt: "background work",
      await: false,
    });

    await vi.waitFor(() => {
      expect(seen.length).toBeGreaterThanOrEqual(1);
    });
    expect(seen[0]).toHaveProperty("type", "agent_update");

    await client.disconnect();
    await localServer.stop();
  });
});

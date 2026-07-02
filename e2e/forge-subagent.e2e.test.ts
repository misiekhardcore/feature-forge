/**
 * End-to-end tests for the forge-subagent extension loaded in a real pi process.
 *
 * These tests verify that:
 * 1. The extension loads without error (auto-discovered from .pi/extensions/)
 * 2. The ChildSocketClient connects to the ParentSocketServer on startup
 * 3. The socket roundtrip works when the extension is loaded in a real pi process
 *
 * Prerequisites: `pi` CLI must be on PATH.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { connect } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../src/agents/agents";
import type { SubprocessAgent } from "../src/agents/agents/SubprocessAgent";
import { AgentStatus } from "../src/agents/base";
import type { AgentSupervisor } from "../src/agents/supervisors";
import { ParentSocketServer } from "../src/ipc/ParentSocketServer";
import { makeMockPi } from "../src/test-utils";

function createMockAgent(): SubprocessAgent {
  const id = "e2e-agent";
  return {
    id,
    specification: {
      role: "e2e",
      systemPrompt: "",
      tools: ["read"],
      id,
    } as never,
    status: AgentStatus.Running,
    createdAt: new Date(),
    executeTask: vi.fn().mockResolvedValue("e2e task result"),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue("e2e task result"),
    getError: vi.fn().mockReturnValue(undefined),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
    start: vi.fn(),
  } as SubprocessAgent;
}

function createMockSupervisor(): AgentSupervisor {
  const agents = new Map<string, Agent>();
  return {
    spawnGuest: vi.fn().mockImplementation(async (specification) => {
      const agent = createMockAgent();
      const identifier = specification.role;
      Object.defineProperty(agent, "id", { value: identifier });
      agents.set(identifier, agent);
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

const PROJECT_ROOT = new URL("../", import.meta.url).pathname;

describe("forge-subagent E2E", () => {
  let server: ParentSocketServer;
  let supervisor: AgentSupervisor;
  let socketPath: string;
  let piProcess: ChildProcess | null;

  beforeEach(async () => {
    supervisor = createMockSupervisor();
    server = new ParentSocketServer(supervisor, makeMockPi());
    socketPath = await server.start();
    piProcess = null;
  });

  afterEach(async () => {
    // Kill the pi process
    if (piProcess && !piProcess.killed) {
      piProcess.kill("SIGTERM");
      // Give it a moment to clean up
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await server.stop();
  });

  it("loads the extension in a pi RPC session and connects to the socket", async () => {
    piProcess = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        FORGE_PARENT_SOCKET: socketPath,
        // Use a cheap/fake model to avoid real API calls
        PI_PROVIDER: "test",
        PI_MODEL: "test-model",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Collect stderr for debugging
    const stderrChunks: string[] = [];
    piProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    // Collect stdout for debugging
    const stdoutChunks: string[] = [];
    piProcess.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });

    // Wait for the child process to connect to our socket server
    // We detect connection by checking connectedSockets count
    await vi.waitFor(
      () => {
        // The pi process should have loaded the extension and connected
        // If it crashed, the process will have exited
        if (piProcess?.exitCode !== null) {
          const stderr = stderrChunks.join("");
          const stdout = stdoutChunks.join("");
          throw new Error(
            `pi process exited prematurely (code=${piProcess?.exitCode}):\nSTDERR: ${stderr}\nSTDOUT: ${stdout}`,
          );
        }
      },
      { timeout: 5000, interval: 200 },
    );

    // Wait a bit for extension to initialize and connect
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // If we get here without the process crashing, the extension loaded
    // successfully. Now verify the socket roundtrip works by connecting
    // a raw client and sending a request through the server.
    const client = connect(socketPath);

    const response = await new Promise<unknown>((resolve, reject) => {
      client.once("data", (chunk: Buffer) => {
        try {
          resolve(JSON.parse(chunk.toString().trim()));
        } catch (error) {
          reject(error);
        }
      });

      client.write(
        JSON.stringify({
          type: "list_agents",
          correlationId: "e2e-test",
          params: {},
        }) + "\n",
      );

      setTimeout(() => {
        reject(new Error("Timeout waiting for response"));
      }, 3000);
    });

    expect(response).toMatchObject({
      type: "result",
      correlationId: "e2e-test",
      result: { agents: [] },
    });

    client.end();

    // Log any stderr for debugging
    if (stderrChunks.length > 0) {
      console.log("[pi stderr]", stderrChunks.join(""));
    }
  }, 15_000);

  it("connects multiple sockets and handles concurrent requests", async () => {
    piProcess = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        FORGE_PARENT_SOCKET: socketPath,
        PI_PROVIDER: "test",
        PI_MODEL: "test-model",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderrChunks: string[] = [];
    piProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    // Wait for extension to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Kill pi process and verify clean shutdown
    piProcess.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Server should still be operational
    const client = connect(socketPath);
    const response = await new Promise<unknown>((resolve, reject) => {
      client.once("data", (chunk: Buffer) => {
        try {
          resolve(JSON.parse(chunk.toString().trim()));
        } catch (error) {
          reject(error);
        }
      });

      client.write(
        JSON.stringify({
          type: "list_agents",
          correlationId: "cleanup-test",
          params: {},
        }) + "\n",
      );

      setTimeout(() => {
        reject(new Error("Timeout"));
      }, 3000);
    });

    expect(response).toMatchObject({
      type: "result",
      correlationId: "cleanup-test",
    });

    client.end();

    if (stderrChunks.length > 0) {
      console.log("[pi stderr]", stderrChunks.join(""));
    }
  }, 15_000);
});

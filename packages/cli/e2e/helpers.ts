/**
 * Shared utilities for e2e tests.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { connect } from "node:net";

import { expect, vi } from "vitest";

import type { Agent } from "../src/agents/agents";
import type { InSessionAgent } from "../src/agents/agents/InSessionAgent";
import type { SubprocessAgent } from "../src/agents/agents/SubprocessAgent";
import { AgentStatus } from "../src/agents/base";
import type { AgentSpecification, AgentSpecificationParams } from "../src/agents/specifications";
import { DynamicAgentSpecification } from "../src/agents/specifications/DynamicAgentSpecification";
import type { AgentSupervisor } from "../src/agents/supervisors";
import { ParentSocketServer } from "../src/ipc/ParentSocketServer";
import { makeMockPi, makeMockSpecManager } from "../src/test-utils";

/** Absolute path to the CLI package root (where package.json lives). */
export const PROJECT_ROOT = new URL("../", import.meta.url).pathname;

/**
 * Create an {@link AgentSpecification} instance from optional parameter overrides.
 *
 * Defaults produce a minimal spec with id/role `"e2e-spec"`, an empty system prompt,
 * and the `read` tool.
 */
export function createMockSpec(
  params?: Partial<AgentSpecificationParams>,
): DynamicAgentSpecification {
  const { id, role, systemPrompt, tools, ...rest } = params ?? {};
  return new DynamicAgentSpecification({
    id: id ?? "e2e-spec",
    role: role ?? "e2e-spec",
    systemPrompt: systemPrompt ?? "",
    tools: tools ?? ["read"],
    ...rest,
  });
}

/**
 * Create a mock {@link SubprocessAgent} for use in supervisor-driven e2e tests.
 *
 * If no specification is provided, one is created via {@link createMockSpec}.
 */
export function createMockAgent(specification?: AgentSpecification): SubprocessAgent {
  const spec = specification ?? createMockSpec();
  return {
    id: spec.id,
    specification: spec,
    status: AgentStatus.Running,
    createdAt: new Date(),
    executeTask: vi.fn().mockResolvedValue("e2e task result"),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue("e2e task result"),
    getError: vi.fn().mockReturnValue(undefined),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
    start: vi.fn(),
  };
}

/**
 * Create a mock {@link InSessionAgent}.
 */
function createMockInSessionAgent(specification: AgentSpecification): InSessionAgent {
  return {
    id: specification.id,
    specification,
    status: AgentStatus.Running,
    createdAt: new Date(),
    mount: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock {@link AgentSupervisor} backed by an in-memory agent map.
 *
 * `spawnGuest` creates a {@link SubprocessAgent} via {@link createMockAgent}
 * using the passed specification and registers it under the spec's `id`.
 */
export function createMockSupervisor(): AgentSupervisor {
  const agents = new Map<string, Agent>();
  return {
    spawnGuest: vi.fn().mockImplementation(async (specification: AgentSpecification) => {
      const agent = createMockAgent(specification);
      agents.set(specification.id, agent);
      return agent;
    }),
    mountInSession: vi.fn().mockImplementation(async (specification: AgentSpecification) => {
      const agent = createMockInSessionAgent(specification);
      agents.set(specification.id, agent);
      return agent;
    }),
    runAgent: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockImplementation((id: string) => agents.get(id)),
    getAllAgents: vi.fn().mockImplementation(() => Array.from(agents.values())),
    destroyAgent: vi.fn().mockImplementation(async (id: string) => {
      agents.delete(id);
    }),
    destroyAll: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Spawn a pi child process, wait for it to stabilise, then perform a socket
 * roundtrip and verify no spec-related errors appear in stderr.
 *
 * @param forgeSpec — A spec object to serialise as `FORGE_SPEC`, or `null`
 *   to omit the variable entirely.
 * @param testName — Unstable correlation id used in the roundtrip.
 */
export async function spawnAndVerify(
  forgeSpec: AgentSpecificationParams | null,
  testName: string,
): Promise<void> {
  const supervisor = createMockSupervisor();
  const server = new ParentSocketServer(supervisor, makeMockPi(), makeMockSpecManager());

  const socketPath = await server.start();
  let piProcess: ChildProcess | null = null;

  const env: Record<string, string> = {
    ...process.env,
    FORGE_PARENT_SOCKET: socketPath,
    PI_PROVIDER: "test",
    PI_MODEL: "test-model",
  };

  if (forgeSpec !== null) {
    env.FORGE_SPEC = JSON.stringify(forgeSpec);
  }

  try {
    piProcess = spawn("pi", ["--mode", "rpc", "--no-session"], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stderrChunks: string[] = [];
    piProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    const stdoutChunks: string[] = [];
    piProcess.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString());
    });

    // Wait for the process to stabilise (not crash)
    await vi.waitFor(
      () => {
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

    // Wait for extension to initialise and connect
    await new Promise((r) => setTimeout(r, 1500));

    // Socket roundtrip
    const client = connect(socketPath);
    const response = await new Promise<unknown>((res, rej) => {
      client.once("data", (chunk: Buffer) => {
        try {
          res(JSON.parse(chunk.toString().trim()));
        } catch (error) {
          rej(new Error(error instanceof Error ? error.message : String(error), { cause: error }));
        }
      });

      client.write(
        JSON.stringify({
          type: "list_agents",
          correlationId: testName,
          params: {},
        }) + "\n",
      );

      setTimeout(() => rej(new Error("Timeout waiting for response")), 3000);
    });

    expect(response).toMatchObject({
      type: "result",
      correlationId: testName,
      result: { agents: [] },
    });

    client.end();

    // Verify no spec-related errors in stderr
    const stderr = stderrChunks.join("");
    expect(stderr).not.toMatch(
      /Failed to deserialize|failed to load|Error loading|Spec.*not found/i,
    );

    if (stderr.length > 0) {
      console.log(`[pi stderr:${testName}]`, stderr);
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
  } finally {
    if (piProcess && !piProcess.killed) {
      piProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
    }
    await server.stop();
  }
}

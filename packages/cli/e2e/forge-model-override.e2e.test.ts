/**
 * End-to-end test for the model override in agent instruction flow execution.
 *
 * Verifies that when a flow defines an agent step with a `model` field,
 * the override propagates through the full execution path:
 * flow loader → RoutineExecutor → AgentStepExecutor → createDynamic → spawnGuest.
 *
 * Run via: `npm run test:e2e`
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentSpecification } from "@feature-forge/core/src/agents/specifications/AgentSpecification";
import { DynamicAgentSpecification } from "@feature-forge/core/src/agents/specifications/DynamicAgentSpecification";
import type { SubprocessAgent } from "@feature-forge/core/src/agents/SubprocessAgent";
import { InMemoryAgentSupervisor } from "@feature-forge/core/src/agents/supervisors/InMemoryAgentSupervisor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStepExecutorRegistry } from "../src/orchestrator/createStepExecutorRegistry";
import type { FlowDefinition } from "../src/orchestrator/FlowInstruction";
import { FLOW_SCHEMA_URL } from "../src/orchestrator/FlowInstruction";
import { RoutineExecutor } from "../src/orchestrator/RoutineExecutor";
import { makeMockToolRegistry, makeMockTypedEventBus } from "../src/test-utils";
import { MockWorkspaceProvider, MockWorktreeRegistry } from "../src/test-utils";
import { WorkspaceManager } from "../src/workspace/WorkspaceManager";
import { WorkspaceProviderRegistry } from "../src/workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../src/workspace/WorktreeRegistry";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeMockAgent(): SubprocessAgent {
  return {
    id: "model-test-agent",
    kind: "subprocess",
    specification: new DynamicAgentSpecification({
      id: "model-test-agent",
      role: "test",
      systemPrompt: "",
      toolRestrictions: { read: [] },
    }),
    status: "running" as const,
    createdAt: new Date(),
    executeTask: vi.fn().mockResolvedValue('{"passed": true, "summary": "done"}'),
    destroy: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockReturnValue('{"passed": true, "summary": "done"}'),
    getError: vi.fn().mockReturnValue(undefined),
    deliverResult: vi.fn(),
    deliverError: vi.fn(),
    start: vi.fn(),
  } as unknown as SubprocessAgent;
}

/**
 * Flow that defines a single agent step with a model override.
 */
function makeModelOverrideFlow(): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "model-override-test",
    command: "/model-override-test",
    orchestrator: { systemPrompt: "test" },
    routines: [
      {
        id: "run_model_agent",
        params: [],
        steps: [
          {
            type: "agent" as const,
            id: "builder",
            systemPrompt: "build",
            prompt: "do it",
            model: "claude-sonnet-4-5",
          },
        ],
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Flow model override (e2e)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-e2e-model-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates model override from flow instruction to spawnGuest", async () => {
    // Track the specification received by the agent factory.
    let receivedSpec: AgentSpecification | undefined;
    const agent = makeMockAgent();

    const mockFactory = {
      create: vi.fn().mockImplementation(async (spec: AgentSpecification) => {
        receivedSpec = spec;
        return { ...agent, id: spec.id };
      }),
    };

    const supervisor = new InMemoryAgentSupervisor(mockFactory);

    // SpecManager that resolves "build" to a base spec.
    const specManager = {
      resolve: vi.fn().mockReturnValue(
        new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "You are a builder.",
          toolRestrictions: { read: [] },
        }),
      ),
      createDynamic: vi
        .fn()
        .mockImplementation(
          (params: Record<string, unknown>) => new DynamicAgentSpecification(params as never),
        ),
    } as never;

    const workspaceProviderRegistry = new WorkspaceProviderRegistry();
    const worktreeRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(tmpDir));

    const stepRegistry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry()),
    );

    const flow = makeModelOverrideFlow();
    const executor = new RoutineExecutor(
      flow,
      stepRegistry,
      makeMockTypedEventBus(),
      makeMockToolRegistry(),
    );

    const result = await executor.run("run_model_agent", {}, "test prompt");

    expect(result.passed).toBe(true);

    // Verify the agent factory received a spec with the model override.
    expect(receivedSpec).toBeDefined();
    expect(receivedSpec!.model).toBe("claude-sonnet-4-5");
    // The base spec fields should also be present.
    expect(receivedSpec!.role).toBe("build");
  });

  it("does not set model when agent instruction lacks model field", async () => {
    let receivedSpec: AgentSpecification | undefined;
    const agent = makeMockAgent();

    const mockFactory = {
      create: vi.fn().mockImplementation(async (spec: AgentSpecification) => {
        receivedSpec = spec;
        return { ...agent, id: spec.id };
      }),
    };

    const supervisor = new InMemoryAgentSupervisor(mockFactory);

    const specManager = {
      resolve: vi.fn().mockReturnValue(
        new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "You are a builder.",
          toolRestrictions: { read: [] },
        }),
      ),
      createDynamic: vi
        .fn()
        .mockImplementation(
          (params: Record<string, unknown>) => new DynamicAgentSpecification(params as never),
        ),
    } as never;

    const workspaceProviderRegistry = new WorkspaceProviderRegistry();
    const worktreeRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(tmpDir));

    const stepRegistry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry()),
    );

    const flow: FlowDefinition = {
      $schema: FLOW_SCHEMA_URL,
      name: "no-model-test",
      command: "/no-model-test",
      orchestrator: { systemPrompt: "test" },
      routines: [
        {
          id: "run_agent",
          params: [],
          steps: [
            {
              type: "agent" as const,
              id: "builder",
              systemPrompt: "build",
              prompt: "do it",
              // No model field — should not override
            },
          ],
        },
      ],
    };

    const executor = new RoutineExecutor(
      flow,
      stepRegistry,
      makeMockTypedEventBus(),
      makeMockToolRegistry(),
    );

    const result = await executor.run("run_agent", {}, "test prompt");

    expect(result.passed).toBe(true);
    expect(receivedSpec).toBeDefined();
    expect(receivedSpec!.model).toBeUndefined();
  });
});

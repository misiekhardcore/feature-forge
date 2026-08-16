/**
 * End-to-end test for thinkingLevel override in flow instruction execution.
 *
 * Verifies that when a flow defines an agent step with a `thinkingLevel` field,
 * the override propagates through the full execution path:
 * flow loader → RoutineExecutor → AgentStepExecutor → createDynamic → spawnGuest.
 *
 * Run via: `npm run test:e2e`
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubprocessAgent } from "../src/agents/agents/SubprocessAgent";
import type { AgentSpecification } from "../src/agents/specifications/AgentSpecification";
import { DynamicAgentSpecification } from "../src/agents/specifications/DynamicAgentSpecification";
import { InMemoryAgentSupervisor } from "../src/agents/supervisors/InMemoryAgentSupervisor";
import { createStepExecutorRegistry } from "../src/orchestrator/createStepExecutorRegistry";
import type { AgentInstruction, FlowDefinition } from "../src/orchestrator/FlowInstruction";
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
    id: "think-test-agent",
    kind: "subprocess",
    specification: new DynamicAgentSpecification({
      id: "think-test-agent",
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
 * Flow that defines a single agent step with a thinkingLevel override.
 */
function makeThinkingLevelFlow(
  thinkingLevel: NonNullable<AgentInstruction["thinkingLevel"]>,
): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "thinking-level-test",
    command: "/thinking-level-test",
    orchestrator: { systemPrompt: "test" },
    routines: [
      {
        id: "run_thinking_agent",
        params: [],
        steps: [
          {
            type: "agent" as const,
            id: "builder",
            systemPrompt: "build",
            prompt: "do it",
            thinkingLevel,
          },
        ],
      },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Flow thinkingLevel override (e2e)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-e2e-thinking-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("propagates thinkingLevel from flow instruction to spawnGuest", async () => {
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

    // SpecManager that resolves "build" to a base spec without thinkingLevel.
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

    const flow = makeThinkingLevelFlow("high");
    const executor = new RoutineExecutor(
      flow,
      stepRegistry,
      makeMockTypedEventBus(),
      makeMockToolRegistry(),
    );

    const result = await executor.run("run_thinking_agent", {}, "test prompt");

    expect(result.passed).toBe(true);

    // Verify the agent factory received a spec with the thinkingLevel override.
    expect(receivedSpec).toBeDefined();
    expect(receivedSpec!.thinkingLevel).toBe("high");
    // The base spec fields should also be present.
    expect(receivedSpec!.role).toBe("build");
  });

  it("does not set thinkingLevel when agent instruction lacks the field", async () => {
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
      name: "no-thinking-test",
      command: "/no-thinking-test",
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
              // No thinkingLevel field — should not override
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
    expect(receivedSpec!.thinkingLevel).toBeUndefined();
  });

  it("propagates thinkingLevel alongside model and cwd overrides in a single createDynamic call", async () => {
    const agent = makeMockAgent();

    const mockFactory = {
      create: vi.fn().mockImplementation(async (spec: AgentSpecification) => {
        return { ...agent, id: spec.id };
      }),
    };

    const supervisor = new InMemoryAgentSupervisor(mockFactory);

    const createDynamicSpy = vi
      .fn()
      .mockImplementation(
        (params: Record<string, unknown>) => new DynamicAgentSpecification(params as never),
      );

    const specManager = {
      resolve: vi.fn().mockReturnValue(
        new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "You are a builder.",
          toolRestrictions: { read: [] },
        }),
      ),
      createDynamic: createDynamicSpy,
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
      name: "combined-override-test",
      command: "/combined-test",
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
              model: "claude-sonnet-4-5",
              thinkingLevel: "high",
              workingDir: { path: "/tmp/custom" },
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
    expect(createDynamicSpy).toHaveBeenCalledTimes(1);
    expect(createDynamicSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/custom",
        model: "claude-sonnet-4-5",
        thinkingLevel: "high",
      }),
    );
  });
});

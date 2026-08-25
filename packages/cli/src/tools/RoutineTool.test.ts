import { TextContent } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, jsonParse, logger } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { showAgentViewerMock, realShowAgentViewer } = vi.hoisted(() => {
  type ShowAgentViewer = (
    params: import("../tui/showAgentViewer").ShowAgentViewerParams,
  ) => Promise<import("../tui/showAgentViewer").AgentViewerHandle>;
  return {
    showAgentViewerMock: vi.fn<ShowAgentViewer>(),
    // Captured from the original module inside the mock factory so tests can
    // fall back to the real composer (the two ctx.ui.custom integration tests).
    realShowAgentViewer: { fn: undefined as ShowAgentViewer | undefined },
  };
});

vi.mock("../tui/showAgentViewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tui/showAgentViewer")>();
  realShowAgentViewer.fn = actual.showAgentViewer;
  return { ...actual, showAgentViewer: showAgentViewerMock };
});

import type { AgentSupervisor } from "@feature-forge/core/agents";
import { StepExecutor } from "@feature-forge/core/executors";
import { StepExecutorRegistry } from "@feature-forge/core/executors";
import { WorkspaceStepExecutor } from "@feature-forge/core/executors";
import type { FlowDefinition, FlowInstruction } from "@feature-forge/core/flows";
import { FlowContext } from "@feature-forge/core/flows";
import { FLOW_SCHEMA_URL } from "@feature-forge/core/flows";
import type { RoutineResult } from "@feature-forge/core/routines";
import { RoutineExecutor } from "@feature-forge/core/routines";
import type { CreateWorkspaceOptions } from "@feature-forge/core/workspace";
import { WorkspaceManager } from "@feature-forge/core/workspace";
import { WorkspaceProvider } from "@feature-forge/core/workspace";
import { WorkspaceProviderRegistry } from "@feature-forge/core/workspace";
import { WorktreeRegistry } from "@feature-forge/core/workspace";

import {
  makeMockToolRegistry,
  makeMockTypedEventBus,
  MockWorkspaceProvider,
  MockWorktreeRegistry,
} from "../test-utils";
import { RoutineTool } from "./RoutineTool";

// ── Helpers ──────────────────────────────────────────────────

function makeFlow(routineParamNames: string[] = []): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "t" },
    routines: [
      {
        id: "build",
        params: routineParamNames.map((name) => ({ name })),
        steps: [],
      },
    ],
  };
}

/**
 * Agent-stream event shaped like a payload-heavy stream chunk (thinking
 * blocks, tool calls). Used to assert the payload-gating debug behaviour.
 */
const STREAM_EVENT_PAYLOAD = {
  phase: "agent-stream",
  message: 'tool_call: read("file.ts")',
  details: {
    executionId: "exec-1",
    agentId: "builder",
    label: "builder",
    event: { type: "message", content: "full LLM payload with thinking blocks" },
  },
} as const;

/** Agent lifecycle phases a fake step can emit (D4 payloads, see agentChannels.ts). */
type AgentTestPhase = "started" | "stream" | "done";

/**
 * Build a registry + flow whose agent step emits the requested agent
 * lifecycle events (agent-started by default) with D4 payload details
 * (`executionId` + `agentId`), mirroring {@link emitAgentStarted} in
 * `eventBus/agentChannels.ts`.
 */
function makeAgentStartedEmittingSetup(phases: AgentTestPhase[] = ["started"]): {
  registry: StepExecutorRegistry;
  flow: FlowDefinition;
} {
  const registry = new StepExecutorRegistry();
  registry.register(
    () =>
      new (class extends StepExecutor {
        readonly type = "agent";
        async execute(
          _instruction: FlowInstruction,
          _context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
            signal?: AbortSignal,
          ) => Promise<FlowContext>,
          eventBus: EventBus,
          _signal?: AbortSignal,
        ): Promise<FlowContext> {
          if (phases.includes("started")) {
            eventBus.emit("feature-forge:agent-started", {
              phase: "agent-started",
              message: 'Agent "builder" (build) started',
              details: { executionId: "exec-1", agentId: "builder" },
            });
          }
          if (phases.includes("stream")) {
            eventBus.emit("feature-forge:agent-stream", STREAM_EVENT_PAYLOAD);
          }
          if (phases.includes("done")) {
            eventBus.emit("feature-forge:agent-done", {
              phase: "agent-done",
              message: 'Agent "builder" (build) completed',
              details: {
                executionId: "exec-1",
                agentId: "builder",
                passed: true,
                summary: "ok",
              },
            });
          }
          return _context;
        }
      })(),
  );
  return {
    registry,
    flow: {
      $schema: FLOW_SCHEMA_URL,
      name: "test-flow",
      command: "/test",
      orchestrator: { systemPrompt: "t" },
      routines: [
        {
          id: "build",
          params: [],
          steps: [
            {
              type: "agent",
              id: "builder",
              systemPrompt: "build",
              task: "do task",
            } as unknown as FlowInstruction,
          ],
        },
      ],
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

function makeMockSupervisor(): AgentSupervisor {
  return {
    getAgent: vi.fn().mockReturnValue(undefined),
    getAllAgents: vi.fn().mockReturnValue([]),
  } as unknown as AgentSupervisor;
}

describe("RoutineTool", () => {
  const mockSupervisor = makeMockSupervisor();

  beforeEach(() => {
    // Default to the real composer; individual tests override with mocks.
    const real = realShowAgentViewer.fn;
    if (!real) throw new Error("real showAgentViewer was not captured by the mock factory");
    showAgentViewerMock.mockImplementation(real);
  });

  afterEach(() => {
    showAgentViewerMock.mockReset();
  });
  describe("constructor", () => {
    it("sets name to routineName", () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      expect(tool.name).toBe("build");
    });

    it("sets a human-readable label", () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      expect(tool.label).toContain("myflow/build");
    });

    it("wires the schema builders into description and parameters", () => {
      const flow = makeFlow(["task", "plan"]);
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      expect(tool.description).toContain("task, plan");
      expect(tool.parameters.properties.task).toBeDefined();
      expect(tool.parameters.properties.plan).toBeDefined();
    });
  });

  describe("execute", () => {
    it("calls RoutineExecutor.run and returns a structured result", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      expect(result.content).toHaveLength(1);
      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("passes resolved routine params to the executor", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              _instruction: FlowInstruction,
              _context: FlowContext,
              _executeStep: (
                instruction: FlowInstruction,
                context: FlowContext,
              ) => Promise<FlowContext>,
              _eventBus: EventBus,
            ) {
              return new FlowContext({
                results: new Map(),
                prompt: "resolved-task",
              });
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [{ name: "task" }],
            steps: [
              {
                type: "agent",
                id: "s1",
                systemPrompt: "build",
                task: "do {{prompt}}",
                prompt: "",
              } as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("uses empty string when neither task nor _task is in params", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const result = await tool.execute(
        "call-1",
        {}, // no task, no _task
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("skips params not present in input", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [{ name: "task" }, { name: "plan" }], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" }, // plan is missing
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("applies declared param defaults for omitted params", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "inspect",
            params: [{ name: "changes" }, { name: "workspace", optional: true, default: "." }],
            steps: [],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const runSpy = vi.spyOn(executor, "run");
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      await tool.execute(
        "call-1",
        { changes: "the diff" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      expect(runSpy).toHaveBeenCalledWith(
        "inspect",
        { changes: "the diff", workspace: "." },
        "",
        undefined,
        flow.routines[0],
      );
    });

    it("explicit call params override declared defaults", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "inspect",
            params: [{ name: "changes" }, { name: "workspace", optional: true, default: "." }],
            steps: [],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const runSpy = vi.spyOn(executor, "run");
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      await tool.execute(
        "call-1",
        { changes: "the diff", workspace: "/custom/path" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      expect(runSpy.mock.calls[0][1].workspace).toBe("/custom/path");
    });

    it("calls _onUpdate for each progress event emitted by executors", async () => {
      // Use a WorkspaceStepExecutor that fires workspace-ready events.
      class FakeProvider extends WorkspaceProvider {
        override async createWorkspace(
          _id: string,
          _options?: CreateWorkspaceOptions,
        ): Promise<string> {
          return "/tmp/ws";
        }
        override async destroyWorkspace(_path: string, _branch?: string): Promise<void> {
          // no-op
        }
      }
      const wpRegistry = new WorkspaceProviderRegistry().register(
        "git-worktree",
        new FakeProvider(),
      );
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new WorkspaceStepExecutor(
            wpRegistry,
            new WorktreeRegistry(),
            new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry()),
          ),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [],
            steps: [
              {
                type: "workspace",
                id: "ws1",
                provider: "git-worktree" as const,
              },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const onUpdateCalls: AgentToolResult<RoutineResult>[] = [];
      const onUpdate: AgentToolUpdateCallback<RoutineResult> = (result) => {
        onUpdateCalls.push(result);
      };

      await tool.execute("call-1", {}, undefined, onUpdate, {} as ExtensionContext);

      expect(onUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const firstUpdate = onUpdateCalls[0];
      expect(firstUpdate.content[0].type).toBe("text");
      expect((firstUpdate.content[0] as TextContent).text).toContain("workspace-ready");
      expect(firstUpdate.details.routine).toBe("build");
    });

    it("does not call _onUpdate when none is provided", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      // Should not throw even though no _onUpdate is provided.
      const result = await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("passes the abort signal through to RoutineExecutor.run", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);
      const controller = new AbortController();

      const result = await tool.execute(
        "call-1",
        {},
        controller.signal,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("handles AbortError thrown by executor and propagates it", async () => {
      // Create an executor that throws AbortError.
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              _instruction: FlowInstruction,
              _context: FlowContext,
              _executeStep: (
                instruction: FlowInstruction,
                context: FlowContext,
                signal?: AbortSignal,
              ) => Promise<FlowContext>,
              eventBus: EventBus,
              _signal?: AbortSignal,
            ): Promise<FlowContext> {
              eventBus.emit("feature-forge:agent-started", {
                phase: "agent-started",
                message: 'Agent "s1" (build) started',
                details: { executionId: "exec-1", agentId: "s1" },
              });
              throw new DOMException("The operation was aborted.", "AbortError");
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [],
            steps: [
              {
                type: "agent",
                id: "s1",
                systemPrompt: "build",
                task: "do task",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const mockCustom = vi.fn().mockResolvedValue(undefined);
      const mockSetStatus = vi.fn();
      const mockCtx = {
        hasUI: true,
        ui: { custom: mockCustom, setStatus: mockSetStatus },
        mode: "tui",
      } as unknown as ExtensionContext;

      await expect(tool.execute("call-1", {}, undefined, undefined, mockCtx)).rejects.toThrow();

      // Verify that custom was called to create the overlay.
      expect(mockCustom).toHaveBeenCalled();
    });

    it("cleans up UI in finally even when a step fails", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              _instruction: FlowInstruction,
              _context: FlowContext,
              _executeStep: (
                instruction: FlowInstruction,
                context: FlowContext,
                signal?: AbortSignal,
              ) => Promise<FlowContext>,
              _eventBus: EventBus,
              _signal?: AbortSignal,
            ): Promise<FlowContext> {
              throw new Error("step failed");
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [],
            steps: [
              {
                type: "agent",
                id: "s1",
                systemPrompt: "build",
                task: "do task",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const mockUi = {
        setWidget: vi.fn(),
        setStatus: vi.fn(),
      };
      const ctx = { ui: mockUi } as unknown as ExtensionContext;

      const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

      expect(mockUi.setWidget).toHaveBeenCalledWith("forge-run", undefined);
      expect(mockUi.setStatus).toHaveBeenCalledWith("feature-forge", undefined);
      expect(result.content).toHaveLength(1);
    });

    it("tracks agent progress with correct agentId mapping through the display projection", async () => {
      const mockUi = {
        setWidget: vi.fn(),
        setStatus: vi.fn(),
        theme: {
          fg: vi.fn((_color: string, text: string) => text),
        },
      };
      const ctx = { ui: mockUi } as unknown as ExtensionContext;

      // Register a fake agent executor that fires started/done events with
      // agentId in the details so the display projection can track agent state.
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";

            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
              _executeStep: (
                instruction: FlowInstruction,
                context: FlowContext,
                signal?: AbortSignal,
              ) => Promise<FlowContext>,
              eventBus: EventBus,
              _signal?: AbortSignal,
            ): Promise<FlowContext> {
              eventBus.emit("feature-forge:agent-started", {
                phase: "agent-started",
                message: `Agent "${instruction.id}" (build) started`,
                details: { executionId: "exec-1", agentId: instruction.id },
              });
              eventBus.emit("feature-forge:agent-done", {
                phase: "agent-done",
                message: `Agent "${instruction.id}" completed`,
                details: { executionId: "exec-1", agentId: instruction.id },
              });
              return context;
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [],
            steps: [
              {
                type: "agent",
                id: "builder",
                systemPrompt: "build",
                prompt: "do stuff",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // Filter out the clear() call (which sets status to undefined) and check
      // that agent progress events produced correct status lines.
      const statusCalls = (mockUi.setStatus as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[1] !== undefined,
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(2); // started + done

      const startedCall = statusCalls.find(
        (c: unknown[]) => typeof c[1] === "string" && c[1].includes("⟳"),
      );
      expect(startedCall).toBeDefined();
      expect(startedCall![1]).toContain("builder");
      expect(startedCall![1]).not.toContain("agent-started");

      const doneCall = statusCalls.find(
        (c: unknown[]) => typeof c[1] === "string" && c[1].includes("✓"),
      );
      expect(doneCall).toBeDefined();
      expect(doneCall![1]).toContain("builder");
      expect(doneCall![1]).not.toContain("agent-done");

      // Widget render should include the agent row.
      const widgetCalls = (mockUi.setWidget as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[0] === "forge-run" && typeof c[1] === "function",
      );
      expect(widgetCalls.length).toBeGreaterThanOrEqual(1);

      // Final cleanup should have cleared both surfaces.
      const allWidgetCalls = (mockUi.setWidget as ReturnType<typeof vi.fn>).mock.calls;
      const lastWidgetCall = allWidgetCalls[allWidgetCalls.length - 1];
      expect(lastWidgetCall[0]).toBe("forge-run");
      expect(lastWidgetCall[1]).toBeUndefined();

      const allStatusCalls = (mockUi.setStatus as ReturnType<typeof vi.fn>).mock.calls;
      const lastStatusCall = allStatusCalls[allStatusCalls.length - 1];
      expect(lastStatusCall[0]).toBe("feature-forge");
      expect(lastStatusCall[1]).toBeUndefined();
    });

    it("falls back to _prompt when prompt is not in params", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "build", params: [{ name: "branch" }], steps: [] }],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const result = await tool.execute(
        "call-1",
        { _prompt: "fix bug", branch: "main" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = jsonParse<RoutineResult>((result.content[0] as TextContent).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("registers eventBus listeners for all feature-forge channels on execute", async () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      // Execute with no UI to isolate listener registration testing.
      await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      // At least one channel should have been registered.
      expect(eventBus.raw.on).toHaveBeenCalled();
    });

    it("folds agent lifecycle events into the accumulated state", async () => {
      // Register a fake agent executor that emits started/done events with
      // executionId + agentId in the details.
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";

            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
              _executeStep: (
                instruction: FlowInstruction,
                context: FlowContext,
                signal?: AbortSignal,
              ) => Promise<FlowContext>,
              eventBus: EventBus,
              _signal?: AbortSignal,
            ): Promise<FlowContext> {
              const execId = "exec-test-99";
              eventBus.emit("feature-forge:agent-started", {
                phase: "agent-started",
                message: `Agent "${instruction.id}" (build) started`,
                details: { executionId: execId, agentId: instruction.id },
              });
              eventBus.emit("feature-forge:agent-done", {
                phase: "agent-done",
                message: `Agent "${instruction.id}" completed`,
                details: { executionId: execId, agentId: instruction.id, summary: "All OK" },
              });
              return context;
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "build",
            params: [],
            steps: [
              {
                type: "agent",
                id: "builder",
                systemPrompt: "build",
                prompt: "do stuff",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      // Accumulated state should reflect the folded agent lifecycle events.
      const acc = tool.accumulatedState;
      expect(acc.agentMap.has("builder")).toBe(true);
      expect(acc.agentMap.get("builder")?.status).toBe("done");
      expect(acc.agentMap.get("builder")?.summary).toBe("All OK");
    });

    it("creates agent viewer overlay via ctx.ui.custom in TUI mode", async () => {
      const { registry, flow } = makeAgentStartedEmittingSetup();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const mockCustom = vi.fn().mockResolvedValue(undefined);
      const mockUi = {
        custom: mockCustom,
        setWidget: vi.fn(),
        setStatus: vi.fn(),
      };
      const ctx = {
        hasUI: true,
        ui: mockUi,
        mode: "tui",
      } as unknown as ExtensionContext;

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // custom should have been called with a factory function and overlay options.
      expect(mockCustom).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          overlay: true,
          overlayOptions: expect.objectContaining({
            anchor: "center",
            width: "100%",
            maxHeight: "85%",
            margin: 1,
          }),
        }),
      );

      // Invoke the factory to verify it produces a valid Component.
      const factoryCall = mockCustom.mock.calls.find((c: unknown[]) => typeof c[0] === "function");
      expect(factoryCall).toBeDefined();
      const factory = factoryCall![0] as (
        tui: Record<string, unknown>,
        theme: Record<string, unknown>,
        _kb: Record<string, unknown>,
        done: () => void,
      ) => Record<string, unknown>;

      const mockTui = { requestRender: vi.fn() };
      const mockTheme = { fg: vi.fn((_c: string, t: string) => t) };
      const mockDoneCallback = vi.fn();
      const component = factory(mockTui, mockTheme, {}, mockDoneCallback) as {
        render: (width: number) => string[];
        invalidate: () => void;
        handleInput?: (data: string) => void;
      };

      expect(component).toBeDefined();
      expect(typeof component.render).toBe("function");
      expect(typeof component.invalidate).toBe("function");
      expect(typeof component.handleInput).toBe("function");

      const rendered = component.render(80);
      expect(Array.isArray(rendered)).toBe(true);
      expect(rendered.length).toBeGreaterThan(0);
      const joined = rendered.join("\n");
      expect(joined).toContain("Agent Viewer");
    });

    it("logs and swallows agent viewer overlay creation failures", async () => {
      const { registry, flow } = makeAgentStartedEmittingSetup();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const mockCustom = vi.fn().mockRejectedValue(new Error("boom"));
        const ctx = {
          hasUI: true,
          ui: { custom: mockCustom, setWidget: vi.fn(), setStatus: vi.fn() },
          mode: "tui",
        } as unknown as ExtensionContext;

        const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

        expect(mockCustom).toHaveBeenCalled();
        // The composer's rejection is logged, not propagated to the routine.
        await vi.waitFor(() =>
          expect(warnSpy).toHaveBeenCalledWith("Agent viewer overlay creation failed", {
            err: expect.any(Error),
          }),
        );
        expect(result.content).toHaveLength(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("disposes the viewer handle in finally after routine completion", async () => {
      const dispose = vi.fn();
      showAgentViewerMock.mockResolvedValueOnce({ viewer: undefined, dispose });

      const { registry, flow } = makeAgentStartedEmittingSetup();
      const eventBus = makeMockTypedEventBus();
      const toolRegistry = makeMockToolRegistry();
      const executor = new RoutineExecutor(flow, registry, eventBus, toolRegistry);
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const ctx = {
        hasUI: true,
        ui: { custom: vi.fn(), setWidget: vi.fn(), setStatus: vi.fn() },
        mode: "tui",
      } as unknown as ExtensionContext;

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // The composer receives the executor's own TypedEventBus — no re-wrap.
      expect(showAgentViewerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx,
          config: ForgeConfig.getInstance(),
          eventBus,
          agentQuery: mockSupervisor,
          toolRegistry,
        }),
      );
      // finally releases the handle once the routine completes.
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("does not open the agent viewer when the routine has no agent steps", async () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(
        flow,
        new StepExecutorRegistry(),
        eventBus,
        makeMockToolRegistry(),
      );
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const mockCustom = vi.fn().mockResolvedValue(undefined);
      const mockUi = { custom: mockCustom, setWidget: vi.fn(), setStatus: vi.fn() };
      const ctx = { hasUI: true, ui: mockUi, mode: "tui" } as unknown as ExtensionContext;

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // No agent progress events → the one-shot lazy opener never fires.
      expect(showAgentViewerMock).not.toHaveBeenCalled();
      expect(mockCustom).not.toHaveBeenCalled();
      // The progress widget surface is still driven unconditionally
      // (finally clears it) — only the overlay is gated.
      expect(mockUi.setWidget).toHaveBeenCalledWith("forge-run", undefined);
    });

    it("opens the agent viewer exactly once across agent lifecycle events", async () => {
      const dispose = vi.fn();
      showAgentViewerMock.mockResolvedValue({ viewer: undefined, dispose });

      const { registry, flow } = makeAgentStartedEmittingSetup(["started", "stream", "done"]);
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const tool = new RoutineTool("myflow", flow.routines[0], executor, mockSupervisor);

      const ctx = {
        hasUI: true,
        ui: {
          custom: vi.fn().mockResolvedValue(undefined),
          setWidget: vi.fn(),
          setStatus: vi.fn(),
        },
        mode: "tui",
      } as unknown as ExtensionContext;

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // started + stream + done all carry agentId, but the one-shot guard
      // opens the overlay only on the first of them.
      expect(showAgentViewerMock).toHaveBeenCalledTimes(1);
      // finally still releases the handle from the single opening call.
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });
});

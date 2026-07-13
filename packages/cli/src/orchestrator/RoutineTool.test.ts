import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import { makeMockTypedEventBus } from "../test-utils";
import type { CreateWorkspaceOptions } from "../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../workspace/WorktreeRegistry";
import { WorkspaceStepExecutor } from "./executors/WorkspaceStepExecutor";
import { FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { FLOW_SCHEMA_URL } from "./FlowInstruction";
import type { DisplayContribution } from "./progress/DisplayContribution";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineProgressEvent } from "./RoutineProgress";
import type { RoutineResult } from "./RoutineResult";
import { RoutineTool } from "./RoutineTool";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

// ── Helpers ──────────────────────────────────────────────────

function makeFlow(routineParamNames: string[] = []): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "t" },
    routines: {
      build: {
        params: routineParamNames.map((name) => ({ name })),
        steps: [],
      },
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
  describe("constructor", () => {
    it("sets name to routineName", () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      expect(tool.name).toBe("build");
    });

    it("sets a human-readable label", () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      expect(tool.label).toContain("myflow/build");
    });

    it("sets description without params when routine has none", () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      expect(tool.description).not.toContain("Parameters:");
    });

    it("includes param names in description when routine has params", () => {
      const flow = makeFlow(["task", "plan"]);
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      expect(tool.description).toContain("task, plan");
    });

    it("has typed parameters built from the routine's param declarations", () => {
      const flow = makeFlow(["task", "plan"]);
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      expect(tool.parameters).toBeDefined();
      // The schema is built dynamically — verify it has the expected structure.
      const schemaJson = JSON.stringify(tool.parameters);
      expect(schemaJson).toContain('"task"');
      expect(schemaJson).toContain('"plan"');
    });
  });

  describe("execute", () => {
    it("calls RoutineExecutor.run and returns a structured result", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [],
            steps: [],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
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
        routines: {
          build: {
            params: [{ name: "task" }],
            steps: [
              {
                type: "agent",
                id: "s1",
                systemPrompt: "build",
                task: "do {{prompt}}",
              } as unknown as import("./FlowInstruction").FlowInstruction,
            ],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("uses empty string when neither task nor _task is in params", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: { params: [], steps: [] },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const result = await tool.execute(
        "call-1",
        {}, // no task, no _task
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("skips params not present in input", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [{ name: "task" }, { name: "plan" }],
            steps: [],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" }, // plan is missing
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
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
        override async destroyWorkspace(_path: string): Promise<void> {
          // no-op
        }
      }
      const wpRegistry = new WorkspaceProviderRegistry().register(
        "git-worktree",
        new FakeProvider(),
      );
      const registry = new StepExecutorRegistry();
      registry.register(() => new WorkspaceStepExecutor(wpRegistry, new WorktreeRegistry()));

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [],
            steps: [
              {
                type: "workspace",
                id: "ws1",
                provider: "git-worktree" as const,
              },
            ],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const onUpdateCalls: AgentToolResult<RoutineResult>[] = [];
      const onUpdate: AgentToolUpdateCallback<RoutineResult> = (result) => {
        onUpdateCalls.push(result);
      };

      await tool.execute("call-1", {}, undefined, onUpdate, {} as ExtensionContext);

      expect(onUpdateCalls.length).toBeGreaterThanOrEqual(1);
      const firstUpdate = onUpdateCalls[0];
      expect(firstUpdate.content[0].type).toBe("text");
      expect((firstUpdate.content[0] as { text: string }).text).toContain("workspace-ready");
      expect(firstUpdate.details.routine).toBe("build");
    });

    it("does not call _onUpdate when none is provided", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: { params: [], steps: [] },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      // Should not throw even though no _onUpdate is provided.
      const result = await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("passes the abort signal through to RoutineExecutor.run", async () => {
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [],
            steps: [],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );
      const controller = new AbortController();

      const result = await tool.execute(
        "call-1",
        {},
        controller.signal,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
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
              _eventBus: EventBus,
              _signal?: AbortSignal,
            ): Promise<FlowContext> {
              throw new DOMException("The operation was aborted.", "AbortError");
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
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
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

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
        routines: {
          build: {
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
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

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

    it("tracks agent progress with correct agentId mapping through display contributions", async () => {
      const mockUi = {
        setWidget: vi.fn(),
        setStatus: vi.fn(),
        theme: {
          fg: vi.fn((_color: string, text: string) => text),
        },
      };
      const ctx = { ui: mockUi } as unknown as ExtensionContext;

      // Register a fake agent executor that fires started/done events AND
      // provides getDisplayContribution so RoutineTool can extract agent state.
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";

            override getDisplayContribution(
              event: RoutineProgressEvent,
            ): DisplayContribution | undefined {
              if (!event.phase.startsWith("agent-")) return undefined;
              const agentId = /Agent "([^"]+)"/.exec(event.message)?.[1];
              if (!agentId) return undefined;
              const agentStatus =
                event.phase === "agent-started"
                  ? "started"
                  : event.phase === "agent-done"
                    ? "done"
                    : undefined;
              return { agentId, agentStatus, phase: event.phase, message: event.message };
            }

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
                details: {},
              });
              eventBus.emit("feature-forge:agent-done", {
                phase: "agent-done",
                message: `Agent "${instruction.id}" completed`,
                details: {},
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
        routines: {
          build: {
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
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      await tool.execute("call-1", {}, undefined, undefined, ctx);

      // Filter out the clear() call (which sets status to undefined) and check
      // that agent progress events produced correct status lines.
      const statusCalls = (mockUi.setStatus as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: unknown[]) => c[1] !== undefined,
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(2); // started + done

      const startedCall = statusCalls.find(
        (c: unknown[]) => typeof c[1] === "string" && c[1].includes("⏳"),
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
        routines: {
          build: {
            params: [{ name: "branch" }],
            steps: [],
          },
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      const result = await tool.execute(
        "call-1",
        { _prompt: "fix bug", branch: "main" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("registers eventBus listeners for all feature-forge channels on execute", async () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      // Execute with no UI to isolate listener registration testing.
      await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      // At least one channel should have been registered.
      expect(eventBus.raw.on).toHaveBeenCalled();
    });

    it("extracts executionId from display contributions and accumulates them", async () => {
      // Register a fake agent executor that emits events with executionId
      // and provides getDisplayContribution that returns executionId.
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";

            override getDisplayContribution(
              event: RoutineProgressEvent,
            ): DisplayContribution | undefined {
              if (!event.phase.startsWith("agent-")) return undefined;
              const agentId = /Agent "([^"]+)"/.exec(event.message)?.[1];
              if (!agentId) return undefined;
              return {
                executionId: event.details.executionId,
                agentId,
                agentStatus:
                  event.phase === "agent-started"
                    ? "started"
                    : event.phase === "agent-done"
                      ? "done"
                      : undefined,
                streamEvent: event.phase === "agent-stream" ? event.details.event : undefined,
                phase: event.phase,
                message: event.message,
              };
            }

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
                details: { executionId: execId },
              });
              eventBus.emit("feature-forge:agent-done", {
                phase: "agent-done",
                message: `Agent "${instruction.id}" completed`,
                details: { executionId: execId, summary: "All OK" },
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
        routines: {
          build: {
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
        },
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

      await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);

      // Contributions should include executionId from the emitted events.
      const contributions = tool.contributions;
      const startedContribution = contributions.find((c) => c.agentStatus === "started");
      const doneContribution = contributions.find((c) => c.agentStatus === "done");

      expect(startedContribution).toBeDefined();
      expect(startedContribution!.executionId).toBe("exec-test-99");
      expect(startedContribution!.agentId).toBe("builder");

      expect(doneContribution).toBeDefined();
      expect(doneContribution!.executionId).toBe("exec-test-99");
      expect(doneContribution!.agentId).toBe("builder");
    });

    it("creates agent viewer overlay via ctx.ui.custom in TUI mode", async () => {
      const flow = makeFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry(), eventBus);
      const tool = new RoutineTool(
        "myflow",
        "build",
        executor,
        flow.routines["build"],
        mockSupervisor,
      );

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
            maxHeight: "95%",
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
  });
});

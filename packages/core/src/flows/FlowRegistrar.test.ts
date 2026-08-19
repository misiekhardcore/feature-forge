// Test-only value imports from cli: RoutineTool now lives at cli/src/tools (S6);
// cli test-utils self-heal when it moves to core (#229).
import { RoutineTool } from "@feature-forge/cli/src/tools/RoutineTool";
import { logger } from "@feature-forge/core";
import type { InMemoryAgentSupervisor } from "@feature-forge/core/src/agents";
import type { SpecManager } from "@feature-forge/core/src/agents/SpecManager";
import { OrchestratorCommand } from "@feature-forge/core/src/commands/OrchestratorCommand";
import { StepExecutorRegistry } from "@feature-forge/core/src/executors/StepExecutorRegistry";
import type { CommandRegistry } from "@feature-forge/core/src/registry/CommandRegistry";
import type { ToolRegistry } from "@feature-forge/core/src/registry/ToolRegistry";
import { makeMockPi, makeMockTypedEventBus } from "@feature-forge/core/src/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import type { FlowDefinition } from "./FlowInstruction";
import { FLOW_SCHEMA_URL } from "./FlowInstruction";
import type { FlowRegistrarContext } from "./FlowRegistrar";
import { FlowRegistrar } from "./FlowRegistrar";
import { FlowStateStore } from "./FlowStateStore";

// ── Hoisted mock state ───────────────────────────────────────

const {
  readdirMock,
  discoverFlowDirsMock,
  flowLoaderLoadMock,
  flowLoaderCtorMock,
  routineExecutorCtorMock,
  specManagerLoadFromDirectoryMock,
  specManagerSpecNamesMock,
} = vi.hoisted(() => {
  const readdir =
    vi.fn<
      (
        flowsDir: string,
        options?: { withFileTypes?: boolean },
      ) => Promise<{ name: string; isDirectory: () => boolean }[]>
    >();
  const load = vi.fn<() => Promise<FlowDefinition>>();

  // Mirror the real discoverFlowDirectories helper: delegate to readdirMock
  // so existing assertions about readdir calls and directory filtering hold.
  const discoverFlowDirs = vi.fn(async (flowsDir: string) => {
    try {
      const entries = await readdir(flowsDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  });

  // Must use named functions — arrow functions are not constructable
  function FlowLoaderMock() {
    return { load };
  }
  const flowLoaderCtor = vi.fn(FlowLoaderMock);

  // FlowRegistrar only threads the executor into the routine-tool factory
  // (which reads stepRegistry for display handlers) — nothing executes
  // routines here, so a constructable stub is safe.
  function RoutineExecutorMock(...args: unknown[]) {
    return { stepRegistry: args[1] };
  }
  const routineExecutorCtor = vi.fn(RoutineExecutorMock);

  const specManagerLoadFromDirectory = vi.fn<() => Promise<void>>();
  const specManagerSpecNames = vi.fn<() => ReadonlySet<string>>();

  return {
    readdirMock: readdir,
    discoverFlowDirsMock: discoverFlowDirs,
    flowLoaderLoadMock: load,
    flowLoaderCtorMock: flowLoaderCtor,
    routineExecutorCtorMock: routineExecutorCtor,
    specManagerLoadFromDirectoryMock: specManagerLoadFromDirectory,
    specManagerSpecNamesMock: specManagerSpecNames,
  };
});

vi.mock("node:fs/promises", () => ({
  readdir: readdirMock,
}));

vi.mock("./FlowLoader", () => ({
  FlowLoader: flowLoaderCtorMock,
  discoverFlowDirectories: discoverFlowDirsMock,
}));

vi.mock("../routines/RoutineExecutor", () => ({
  RoutineExecutor: routineExecutorCtorMock,
}));

// ── Helpers ──────────────────────────────────────────────────

function makeParams(overrides: Partial<FlowRegistrarContext> = {}): FlowRegistrarContext {
  const pi = overrides.pi ?? makeMockPi();
  // The concrete registries are replaced with structural mocks: registerFlow
  // only touches registerInstance, so a single-method mock is enough.
  const cmdRegistry =
    overrides.cmdRegistry ?? ({ registerInstance: vi.fn() } as unknown as CommandRegistry);
  const toolRegistry =
    overrides.toolRegistry ??
    ({ registerInstance: vi.fn(), get: vi.fn() } as unknown as ToolRegistry);
  return {
    pi,
    cmdRegistry,
    toolRegistry,
    supervisor: overrides.supervisor ?? ({} as InMemoryAgentSupervisor),
    specManager:
      overrides.specManager ??
      ({
        loadFromDirectory: specManagerLoadFromDirectoryMock,
        specNames: specManagerSpecNamesMock,
      } as unknown as SpecManager),
    workspaceManager:
      overrides.workspaceManager ?? ({} as FlowRegistrarContext["workspaceManager"]),
    flowDirs: overrides.flowDirs ?? ["/flows"],
    knownProviders: overrides.knownProviders ?? new Set(),
    stepExecutorRegistry: overrides.stepExecutorRegistry ?? new StepExecutorRegistry(),
    eventBus: overrides.eventBus ?? makeMockTypedEventBus(),
    activeFlowRegistry: overrides.activeFlowRegistry ?? new ActiveFlowRegistry(),
    // RoutineTool stays cli-owned (S6 seam) — the factory is still provided
    // by the composition root.
    createRoutineTool:
      overrides.createRoutineTool ??
      ((flowName, routineDef, routineExecutor, supervisor) =>
        new RoutineTool(flowName, routineDef, routineExecutor, supervisor)),
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "test-orchestrator" },
    routines: overrides.routines ?? [{ id: "build", params: [], steps: [] }],
    ...overrides,
  };
}

function setupSingleFlow() {
  readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
  flowLoaderLoadMock.mockResolvedValue(makeFlow());
}

// ── Tests ────────────────────────────────────────────────────

describe("FlowRegistrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
    specManagerSpecNamesMock.mockReturnValue(new Set());
  });

  describe("registerAll", () => {
    it("discovers flow directories from the flows directory", async () => {
      readdirMock.mockResolvedValue([
        { name: "flow-a", isDirectory: () => true },
        { name: "flow-b", isDirectory: () => true },
      ]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const params = makeParams({ flowDirs: ["/custom/flows"] });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(readdirMock).toHaveBeenCalledWith("/custom/flows", {
        withFileTypes: true,
      });
    });

    it("filters out non-directory entries", async () => {
      readdirMock.mockResolvedValue([
        { name: "flow-a", isDirectory: () => true },
        { name: "README.md", isDirectory: () => false },
        { name: "flow-b", isDirectory: () => true },
      ]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Only flow-a and flow-b should be processed => 2 registerInstance calls
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(2);
    });

    it("skips flows without an orchestrator (schema rejection) and logs a warning", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([
        { name: "valid-flow", isDirectory: () => true },
        { name: "headless-flow", isDirectory: () => true },
      ]);
      // valid-flow loads; headless-flow fails schema validation (orchestrator is required).
      flowLoaderLoadMock
        .mockResolvedValueOnce(makeFlow())
        .mockRejectedValueOnce(
          new Error("Invalid flow definition: ... /orchestrator: Expected required property"),
        );

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Only valid-flow's OrchestratorCommand is registered.
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load flow "headless-flow"'),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("skips flows that fail to load and logs a warning (non-Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "broken-flow", isDirectory: () => true }]);
      specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockRejectedValue("raw string error");

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load flow "broken-flow"'),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("skips flows that fail to load and logs a warning (Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "broken-flow", isDirectory: () => true }]);
      specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockRejectedValue(new Error("Invalid JSON"));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[feature-forge] Failed to load flow "broken-flow"'),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("registers an orchestrator command via cmdRegistry for valid flows", async () => {
      setupSingleFlow();

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const pi = makeMockPi();
      const params = makeParams({ pi, cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      // The command passed to registerInstance is the real core
      // OrchestratorCommand — constructed directly by FlowRegistrar now that
      // the command seam is gone (no more factory at the composition root).
      const registeredCmd = (cmdRegistry.registerInstance as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as OrchestratorCommand;
      expect(registeredCmd).toBeInstanceOf(OrchestratorCommand);
      expect(registeredCmd.name).toBe("test"); // flow.command "/test" minus slash
      expect(registeredCmd.description).toBe("Run the test-flow orchestrator workflow");
      expect(registeredCmd.handler).toBeInstanceOf(Function);
      // The OrchestratorCommand receives the flow's store and the shared
      // active-flow registry so set_flow_param routes to this flow.
      expect((registeredCmd as unknown as { store: FlowStateStore }).store).toBeInstanceOf(
        FlowStateStore,
      );
      expect((registeredCmd as unknown as { activeFlow: ActiveFlowRegistry }).activeFlow).toBe(
        params.activeFlowRegistry,
      );
      // The SAME store instance must be threaded to RoutineExecutor and
      // OrchestratorCommand so the shared set_flow_param tool and routine
      // session steps write into one FlowStateStore per flow.
      expect(routineExecutorCtorMock).toHaveBeenCalledTimes(1);
      const executorStore = routineExecutorCtorMock.mock.calls[0][4];
      expect(executorStore).toBeInstanceOf(FlowStateStore);
      expect((registeredCmd as unknown as { store: FlowStateStore }).store).toBe(executorStore);
    });

    it("loads the orchestrator persona before constructing FlowLoader", async () => {
      setupSingleFlow();

      const params = makeParams();
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/flows/my-flow");
      expect(flowLoaderCtorMock).toHaveBeenCalled();
      // Specs must be loaded before FlowLoader snapshots knownSpecs so the
      // orchestrator-spec semantic check can resolve systemPrompt.
      expect(specManagerLoadFromDirectoryMock.mock.invocationCallOrder[0]).toBeLessThan(
        flowLoaderCtorMock.mock.invocationCallOrder[0],
      );
      // specNames must be read after loadFromDirectory so the knownSpecs
      // snapshot includes all specs the flow's orchestrator may reference.
      expect(specManagerLoadFromDirectoryMock.mock.invocationCallOrder[0]).toBeLessThan(
        specManagerSpecNamesMock.mock.invocationCallOrder[0],
      );
      expect(specManagerSpecNamesMock.mock.invocationCallOrder[0]).toBeLessThan(
        flowLoaderCtorMock.mock.invocationCallOrder[0],
      );
    });

    it("skips the flow when orchestrator spec loading fails", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      specManagerLoadFromDirectoryMock.mockRejectedValue(new Error("spec load boom"));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const params = makeParams({ cmdRegistry, toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load orchestrator specs for flow "my-flow"'),
        expect.any(Object),
      );
      expect(flowLoaderCtorMock).not.toHaveBeenCalled();
      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
      expect(toolRegistry.registerInstance).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("passes knownSpecs and knownProviders to FlowLoader", async () => {
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const knownSpecs = new Set(["spec-a", "spec-b"]);
      specManagerSpecNamesMock.mockReturnValue(knownSpecs);
      const knownProviders = new Set(["provider-x"]);
      const params = makeParams({ knownProviders });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(flowLoaderCtorMock).toHaveBeenCalledWith({
        flowsDir: expect.any(String),
        knownSpecs,
        knownProviders,
      });
    });

    it("registers RoutineTool for each routine in the flow", async () => {
      setupSingleFlow();

      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1); // 1 routine, no builtin
    });

    it("set_flow_param is no longer registered as a builtin", async () => {
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ routines: [{ id: "step1", params: [], steps: [] }] }),
      );

      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Exactly one tool: the declared routine. No builtin set_flow_param tool.
      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
      const registeredTool = (toolRegistry.registerInstance as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(registeredTool).toHaveProperty("name", expect.stringContaining("step1"));
    });

    it("handles RoutineTool registration failures gracefully (non-Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({
          routines: [{ id: "step1", params: [], steps: [] }],
        }),
      );

      const toolRegistry = {
        registerInstance: vi.fn().mockImplementation(() => {
          // Deliberate non-Error throw: verifies the registration guard
          // survives unexpected rejection shapes.
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberate defensive case
          throw "raw string failure";
        }),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1); // 1 routine, no builtin
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register RoutineTool"),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("handles RoutineTool registration failures gracefully (Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({
          routines: [
            { id: "step1", params: [], steps: [] },
            { id: "step2", params: [], steps: [] },
          ],
        }),
      );

      let callCount = 0;
      const toolRegistry = {
        registerInstance: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error("Duplicate tool");
          return undefined;
        }),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // First call threw, second succeeded
      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register RoutineTool"),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("handles missing flowsDir gracefully (empty directory list)", async () => {
      readdirMock.mockRejectedValue(new Error("ENOENT"));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // No flows to process, no commands registered
      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
    });

    it("registers orchestrator commands even when a flow has no routines", async () => {
      readdirMock.mockResolvedValue([{ name: "empty-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow({ routines: [] }));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Command registered, but no tools (no routines to iterate over)
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
    });

    it("registers flows from multiple directories", async () => {
      // First dir has no flows, second dir has "extra-flow"
      readdirMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ name: "extra-flow", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry, flowDirs: ["/builtin/flows", "/extra/flows"] });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Should read from both dirs
      expect(readdirMock).toHaveBeenCalledWith("/builtin/flows", { withFileTypes: true });
      expect(readdirMock).toHaveBeenCalledWith("/extra/flows", { withFileTypes: true });
      // Only one flow registered (extra flow from second dir)
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
    });

    it("handles empty flowDirs gracefully", async () => {
      readdirMock.mockResolvedValue([]);

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry, flowDirs: [] });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // No flows registered
      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
    });

    it("processes multiple flowDirs", async () => {
      readdirMock
        .mockResolvedValueOnce([{ name: "builtin", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "addon-a", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "addon-b", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({
        cmdRegistry,
        flowDirs: ["/builtin", "/addons/one", "/addons/two"],
      });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // 3 flows = 3 commands
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(3);
    });

    it("seeds FlowStateStore with flow-level param defaults", async () => {
      setupSingleFlow();
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({
          params: [
            { name: "base", default: "main" },
            { name: "mode", default: "full" },
            { name: "target", description: "no default here" },
          ],
        }),
      );

      const setSpy = vi.spyOn(FlowStateStore.prototype, "set");

      const params = makeParams();
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(setSpy).toHaveBeenCalledWith("base", "main");
      expect(setSpy).toHaveBeenCalledWith("mode", "full");
      // Params without a default should NOT call set
      expect(setSpy).not.toHaveBeenCalledWith("target", expect.anything());

      setSpy.mockRestore();
    });
  });
});

import * as path from "node:path";

import { Tool } from "@feature-forge/core/tools";
import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InMemoryAgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { OrchestratorCommand } from "../commands/OrchestratorCommand";
import { StepExecutorRegistry } from "../executors/StepExecutorRegistry";
import { logger } from "../logging";
import type { CommandRegistry } from "../registry/CommandRegistry";
import type { ToolRegistry } from "../registry/ToolRegistry";
import { makeMockPi, makeMockTypedEventBus } from "../test-utils";
import { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import type { FlowDefinition } from "./FlowInstruction";
import { FLOW_SCHEMA_URL } from "./FlowInstruction";
import type { FlowRegistrarContext } from "./FlowRegistrar";
import { FlowRegistrar } from "./FlowRegistrar";
import { FlowStateStore } from "./FlowStateStore";

// ── Hoisted mock state ───────────────────────────────────────

const {
  readdirMock,
  peekDeclaredNameMock,
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
  // FlowRegistrar's dir-name guard calls the FlowLoader static
  // peekDeclaredName before any spec load. Default fixtures are supplied in
  // beforeEach, so the class mock carries the static mock.
  const peekDeclaredName = vi.fn(async (flowDir: string): Promise<string | undefined> => flowDir);
  const flowLoaderCtor = Object.assign(vi.fn(FlowLoaderMock), { peekDeclaredName });

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
    peekDeclaredNameMock: peekDeclaredName,
    discoverFlowDirsMock: discoverFlowDirs,
    flowLoaderLoadMock: load,
    flowLoaderCtorMock: flowLoaderCtor,
    routineExecutorCtorMock: routineExecutorCtor,
    specManagerLoadFromDirectoryMock: specManagerLoadFromDirectory,
    specManagerSpecNamesMock: specManagerSpecNames,
  };
});

vi.mock("./FlowLoader", () => ({
  FlowLoader: flowLoaderCtorMock,
  discoverFlowDirectories: discoverFlowDirsMock,
}));

vi.mock("../routines/RoutineExecutor", () => ({
  RoutineExecutor: routineExecutorCtorMock,
}));

// ── Helpers ──────────────────────────────────────────────────

/**
 * Local stand-in for the cli `RoutineTool` (which stays cli-owned, S6 seam):
 * reproduces only the name/label contract this test observes. The real tool
 * renders progress with pi-tui at the composition root; tests never execute
 * routines, so a no-op stub is sufficient.
 */
class TestRoutineTool extends Tool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters = Type.Object({});

  constructor(flowName: string, routineDef: { id: string }) {
    super();
    this.name = routineDef.id;
    this.label = `Routine: ${flowName}/${routineDef.id}`;
    this.description = "stub routine tool";
  }

  async execute(): Promise<never> {
    throw new Error("no-op stub: tests never invoke routine tools");
  }
}

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
    models: overrides.models,
    // Local stub stands in for the cli RoutineTool (S6 seam) — the factory
    // is still provided by the composition root.
    createRoutineTool:
      overrides.createRoutineTool ??
      ((flowName, routineDef) => new TestRoutineTool(flowName, routineDef)),
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

/**
 * Stub one discovered flow dir whose flow.json declares the matching name
 * (the dir-name guard skips flows whose declared name diverges from the
 * directory, so fixtures must stay aligned).
 */
function mockFlowDir(dir: string, overrides: Partial<FlowDefinition> = {}): void {
  readdirMock.mockResolvedValue([{ name: dir, isDirectory: () => true }]);
  flowLoaderLoadMock.mockResolvedValue(makeFlow({ name: dir, command: `/${dir}`, ...overrides }));
}

/**
 * Stub the dir-name peek for one flow dir whose flow.json declares a name
 * that differs from its directory name (or any other one-shot peek reply).
 * RegisterAll's dir-name guard peeks the declared name via
 * FlowLoader.peekDeclaredName before any spec load, so mismatched fixtures
 * must stub the peek, not the FlowLoader result.
 */
function mockFlowJson(declaredName: string): void {
  peekDeclaredNameMock.mockResolvedValueOnce(declaredName);
}

function setupSingleFlow() {
  mockFlowDir("test-flow", { command: "/test" });
}

// ── Tests ────────────────────────────────────────────────────

describe("FlowRegistrar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
    specManagerSpecNamesMock.mockReturnValue(new Set());
    // Default peek fixture: flow.json declares its directory's basename, so
    // healthy dirs pass the dir-name guard. Tests override the peek per flow
    // (mockFlowJson / mockResolvedValueOnce) when they exercise broken or
    // mismatched flow.json fixtures.
    peekDeclaredNameMock.mockImplementation(async (flowDir: string) => path.basename(flowDir));
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
      flowLoaderLoadMock
        .mockResolvedValueOnce(makeFlow({ name: "flow-a", command: "/flow-a" }))
        .mockResolvedValueOnce(makeFlow({ name: "flow-b", command: "/flow-b" }));

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
        .mockResolvedValueOnce(makeFlow({ name: "valid-flow", command: "/valid-flow" }))
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
      const models = {
        smart: { model: "claude-sonnet-4-5", provider: "anthropic", thinkingLevel: "xhigh" },
      } as const;
      const params = makeParams({ pi, cmdRegistry, models });
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
      // ctx.models (threaded from forge config at the composition root) is
      // injected into the OrchestratorCommand for model preset resolution.
      expect((registeredCmd as unknown as { models: typeof models }).models).toEqual(models);
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

      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/flows/test-flow");
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
        makeFlow({
          name: "my-flow",
          command: "/my-flow",
          routines: [{ id: "step1", params: [], steps: [] }],
        }),
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
          name: "my-flow",
          command: "/my-flow",
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
          name: "my-flow",
          command: "/my-flow",
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
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ name: "empty-flow", command: "/empty-flow", routines: [] }),
      );

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
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ name: "extra-flow", command: "/extra-flow" }),
      );

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

    it("keeps the first directory's flow when the same flow name exists in multiple flowDirs", async () => {
      // Same directory name in both layers - first (nearest) dir must win.
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(makeFlow({ name: "implement", command: "/implement" }));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry, flowDirs: ["/project/flows", "/global/flows"] });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Both dirs are still discovered...
      expect(readdirMock).toHaveBeenNthCalledWith(1, "/project/flows", {
        withFileTypes: true,
      });
      expect(readdirMock).toHaveBeenNthCalledWith(2, "/global/flows", {
        withFileTypes: true,
      });
      // ...but only the first occurrence is loaded and registered.
      expect(flowLoaderLoadMock).toHaveBeenCalledTimes(1);
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      // Orchestrator specs load once, from the first (winning) layer's path.
      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(1);
      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/project/flows/implement");
      // flowMap holds exactly one entry (no last-write-wins overwrite).
      expect(registrar.flowMap.size).toBe(1);
      expect(registrar.flowMap.get("implement")).toBeDefined();
    });

    it("registers flows unique to later flowDirs while deduping shared names", async () => {
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([
          { name: "implement", isDirectory: () => true },
          { name: "verify-flow", isDirectory: () => true },
        ]);
      flowLoaderLoadMock
        .mockResolvedValueOnce(makeFlow({ name: "implement", command: "/implement" }))
        .mockResolvedValueOnce(makeFlow({ name: "verify-flow", command: "/verify" }));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const params = makeParams({ cmdRegistry, flowDirs: ["/builtin/flows", "/extra/flows"] });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // implement (shared) loads from the first dir; verify-flow (second-dir
      // only) is still registered from the second dir.
      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(2);
      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/builtin/flows/implement");
      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/extra/flows/verify-flow");
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(2);
      expect(registrar.flowMap.size).toBe(2);
      expect(registrar.flowMap.get("implement")).toBeDefined();
      expect(registrar.flowMap.get("verify-flow")).toBeDefined();
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
      flowLoaderLoadMock
        .mockResolvedValueOnce(makeFlow({ name: "builtin", command: "/builtin" }))
        .mockResolvedValueOnce(makeFlow({ name: "addon-a", command: "/addon-a" }))
        .mockResolvedValueOnce(makeFlow({ name: "addon-b", command: "/addon-b" }));

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

    it("skips a flow whose flow.json name mismatches its directory before any spec load", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "renamed-flow", isDirectory: () => true }]);
      // The directory is "renamed-flow" but its flow.json declares a
      // different name: registerAll dedupes flows by directory name, so this
      // mismatch would slip past the dedupe and land in flowMap under a
      // foreign key. The guard must skip the whole flow at the flow.json
      // peek - BEFORE its orchestrator specs load into the shared
      // SpecRegistry (no spec-load side effect for a skipped flow).
      mockFlowJson("actual-name");

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      try {
        const params = makeParams({ cmdRegistry, toolRegistry });
        const registrar = new FlowRegistrar(params);
        await registrar.registerAll();

        // Nothing loads and nothing registers: no spec load, no FlowLoader
        // construction, no flowMap entry, no routine tools, no commands.
        expect(specManagerLoadFromDirectoryMock).not.toHaveBeenCalled();
        expect(flowLoaderCtorMock).not.toHaveBeenCalled();
        expect(flowLoaderLoadMock).not.toHaveBeenCalled();
        expect(registrar.flowMap.size).toBe(0);
        expect(toolRegistry.registerInstance).not.toHaveBeenCalled();
        expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Skipping flow directory "renamed-flow"'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("falls back to a deeper layer's healthy copy when the nearer flow.json is unreadable", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      // The nearer copy's peek fails (missing/unreadable flow.json or one
      // declaring no usable name) so its name must NOT be claimed...
      peekDeclaredNameMock.mockResolvedValueOnce(undefined);
      // ...and the deeper layer's healthy copy is attempted next and
      // registers (specs load exactly once, from the second dir).
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ name: "implement", command: "/impl-global" }),
      );

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          toolRegistry,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        await registrar.registerAll();

        // Nearer copy skipped loudly; deeper copy wins the name.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Skipping flow directory "implement"'),
        );
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(1);
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/global/flows/implement");
        expect(flowLoaderLoadMock).toHaveBeenCalledTimes(1);
        expect(registrar.flowMap.size).toBe(1);
        // The flowMap entry is the SECOND dir's copy (command proves origin).
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-global");
        expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("falls back to a deeper layer's copy when the nearer layer's flow fails to load", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      // The nearer copy peeks healthy but FlowLoader rejects it (e.g. schema
      // validation). Its name stays unclaimed, so the deeper copy is
      // attempted and registers.
      flowLoaderLoadMock
        .mockRejectedValueOnce(new Error("Invalid flow definition ..."))
        .mockResolvedValueOnce(makeFlow({ name: "implement", command: "/impl-global" }));

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        await registrar.registerAll();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to load flow "implement"'),
          expect.any(Object),
        );
        // Specs load from both layers (the nearer dir loaded before its flow
        // failed); the deeper copy still registers the flow.
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(2);
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/project/flows/implement");
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/global/flows/implement");
        expect(registrar.flowMap.size).toBe(1);
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-global");
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("falls back to a deeper layer's copy when the nearer layer's spec load fails", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      // The nearer copy's orchestrator spec load throws BEFORE FlowLoader is
      // constructed; its name stays unclaimed, so the deeper copy is
      // attempted and registers.
      specManagerLoadFromDirectoryMock
        .mockRejectedValueOnce(new Error("spec load boom"))
        .mockResolvedValueOnce(undefined);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ name: "implement", command: "/impl-global" }),
      );

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        await registrar.registerAll();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to load orchestrator specs for flow "implement"'),
          expect.any(Object),
        );
        // Both layers' spec dirs are attempted (spec load precedes flow
        // load, so the nearer dir loaded its specs before failing)...
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(2);
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/project/flows/implement");
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/global/flows/implement");
        // ...but only the deeper copy's definition is loaded and registered.
        expect(flowLoaderCtorMock).toHaveBeenCalledTimes(1);
        expect(flowLoaderLoadMock).toHaveBeenCalledTimes(1);
        expect(registrar.flowMap.size).toBe(1);
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-global");
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("rolls back the flowMap claim when session wiring construction throws, letting a deeper copy register", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      // The nearer copy peeks, loads, and enters flowMap - then its
      // RoutineTool CONSTRUCTION throws (a wiring failure, distinct from a
      // REGISTRATION failure). flowMap.set already happened, so the
      // registrar must roll the entry back (flowMap.delete) and return
      // false: the deeper copy then claims the name cleanly.
      flowLoaderLoadMock
        .mockResolvedValueOnce(
          makeFlow({
            name: "implement",
            command: "/impl-project",
            routines: [{ id: "nearer-routine", params: [], steps: [] }],
          }),
        )
        .mockResolvedValueOnce(
          makeFlow({
            name: "implement",
            command: "/impl-global",
            routines: [{ id: "deeper-routine", params: [], steps: [] }],
          }),
        );
      // The nearer copy's routine tool cannot be constructed; the deeper
      // copy's routine id is distinguishable so the factory can throw for
      // exactly one layer.
      const createRoutineTool: FlowRegistrarContext["createRoutineTool"] = (
        flowName,
        routineDef,
      ) => {
        if (routineDef.id === "nearer-routine") {
          throw new Error("RoutineTool construction boom");
        }
        return new TestRoutineTool(flowName, routineDef);
      };

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const toolRegistry = {
        registerInstance: vi.fn(),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          toolRegistry,
          createRoutineTool,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        const deleteSpy = vi.spyOn(registrar.flowMap, "delete");
        await registrar.registerAll();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Failed to construct routine tools or orchestrator command for flow "implement"',
          ),
          expect.any(Object),
        );
        // The nearer copy's premature claim is rolled back...
        expect(deleteSpy).toHaveBeenCalledWith("implement");
        // ...so the deeper copy registers exactly once: no stale flowMap
        // entry, no double tool/command registration.
        expect(registrar.flowMap.size).toBe(1);
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-global");
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(2);
        expect(flowLoaderLoadMock).toHaveBeenCalledTimes(2);
        expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("leaves no tools registered from a nearer flow whose second routine tool construction throws", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      // The nearer copy declares TWO routines; its SECOND tool construction
      // throws. All tools are constructed BEFORE anything is registered, so
      // the first nearer tool must never reach the tool registry.
      flowLoaderLoadMock
        .mockResolvedValueOnce(
          makeFlow({
            name: "implement",
            command: "/impl-project",
            routines: [
              { id: "nearer-one", params: [], steps: [] },
              { id: "nearer-two", params: [], steps: [] },
            ],
          }),
        )
        .mockResolvedValueOnce(
          makeFlow({
            name: "implement",
            command: "/impl-global",
            routines: [{ id: "deeper-routine", params: [], steps: [] }],
          }),
        );
      const createRoutineTool: FlowRegistrarContext["createRoutineTool"] = (
        flowName,
        routineDef,
      ) => {
        if (routineDef.id === "nearer-two") {
          throw new Error("RoutineTool construction boom");
        }
        return new TestRoutineTool(flowName, routineDef);
      };

      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      const registerInstance = vi.fn();
      const toolRegistry = {
        registerInstance,
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          toolRegistry,
          createRoutineTool,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        const deleteSpy = vi.spyOn(registrar.flowMap, "delete");
        await registrar.registerAll();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Failed to construct routine tools or orchestrator command for flow "implement"',
          ),
          expect.any(Object),
        );
        // The nearer copy's premature claim is rolled back...
        expect(deleteSpy).toHaveBeenCalledWith("implement");
        // ...with NO routine tool left registered from the nearer copy (the
        // first routine's tool was constructed but never registered), and
        // the deeper copy registers its tool + flowMap entry exactly once.
        expect(registrar.flowMap.size).toBe(1);
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-global");
        expect(registerInstance).toHaveBeenCalledTimes(1);
        expect(registerInstance.mock.calls[0][0]).toMatchObject({ name: "deeper-routine" });
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("keeps the flowMap claim when tool registration throws - a deeper copy is not attempted", async () => {
      // Pins the F1 claim semantics: the definition is healthy and entered
      // flowMap, and a tool/command REGISTRATION failure is non-fatal
      // (warned) - it does NOT release the name, because releasing it would
      // send the deeper copy through the same failing registration while
      // re-registering every tool this copy already registered (double
      // registration). Only a construction throw rolls the claim back.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: "implement", isDirectory: () => true }]);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({ name: "implement", command: "/impl-project" }),
      );
      const toolRegistry = {
        registerInstance: vi.fn().mockImplementation(() => {
          throw new Error("Duplicate tool");
        }),
        get: vi.fn(),
      } as unknown as FlowRegistrarContext["toolRegistry"];
      const cmdRegistry = {
        registerInstance: vi.fn(),
      } as unknown as FlowRegistrarContext["cmdRegistry"];
      try {
        const params = makeParams({
          cmdRegistry,
          toolRegistry,
          flowDirs: ["/project/flows", "/global/flows"],
        });
        const registrar = new FlowRegistrar(params);
        const deleteSpy = vi.spyOn(registrar.flowMap, "delete");
        await registrar.registerAll();

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Failed to register RoutineTool"),
          expect.any(Object),
        );
        // No rollback: the flowMap entry is retained and the name stays
        // claimed by the nearer copy.
        expect(deleteSpy).not.toHaveBeenCalled();
        expect(registrar.flowMap.size).toBe(1);
        expect(registrar.flowMap.get("implement")?.command).toBe("/impl-project");
        // Claimed: the deeper copy is never attempted (no second spec load,
        // no second flow load, no second registration pass).
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledTimes(1);
        expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/project/flows/implement");
        expect(flowLoaderLoadMock).toHaveBeenCalledTimes(1);
        expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
        expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
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

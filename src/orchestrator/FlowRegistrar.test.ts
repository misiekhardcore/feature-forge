import { type EventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InMemoryAgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { logger } from "../logging";
import type { CommandRegistry, ToolRegistry } from "../registry";
import { makeMockEventBus, makeMockPi } from "../test-utils";
import type { WorkspaceManager } from "../workspace";
import type { FlowDefinition } from "./FlowInstruction";
import { FlowRegistrar } from "./FlowRegistrar";
import type { StepExecutorRegistry } from "./StepExecutorRegistry";

// ── Hoisted mock state ───────────────────────────────────────

const {
  readdirMock,
  accessMock,
  flowLoaderLoadMock,
  flowLoaderCtorMock,
  orchestratorCtorMock,
  specManagerLoadFromDirectoryMock,
  specManagerSpecNamesMock,
} = vi.hoisted(() => {
  const readdir = vi.fn<() => Promise<{ name: string; isDirectory: () => boolean }[]>>();
  const access = vi.fn<(p: string) => Promise<void>>();
  const load = vi.fn<() => Promise<FlowDefinition>>();

  // Must use named functions — arrow functions are not constructable
  function FlowLoaderMock() {
    return { load };
  }
  const flowLoaderCtor = vi.fn(FlowLoaderMock);

  function OrchestratorCommandMock() {
    return {
      name: "/cmd",
      description: "desc",
      handler: vi.fn(),
    };
  }
  const orchestratorCtor = vi.fn(OrchestratorCommandMock);
  const specManagerLoadFromDirectory = vi.fn<() => Promise<void>>();
  const specManagerSpecNames = vi.fn<() => ReadonlySet<string>>();

  return {
    readdirMock: readdir,
    accessMock: access,
    flowLoaderLoadMock: load,
    flowLoaderCtorMock: flowLoaderCtor,
    orchestratorCtorMock: orchestratorCtor,
    specManagerLoadFromDirectoryMock: specManagerLoadFromDirectory,
    specManagerSpecNamesMock: specManagerSpecNames,
  };
});

vi.mock("node:fs/promises", () => ({
  readdir: readdirMock,
  access: accessMock,
}));

vi.mock("./FlowLoader", () => ({
  FlowLoader: flowLoaderCtorMock,
}));

vi.mock("../commands", () => ({
  OrchestratorCommand: orchestratorCtorMock,
}));

// ── Helpers ──────────────────────────────────────────────────

interface FlowRegistrarParams {
  pi: ExtensionAPI;
  cmdRegistry: CommandRegistry;
  toolRegistry: ToolRegistry;
  supervisor: InMemoryAgentSupervisor;
  specManager: SpecManager;
  workspaceManager: WorkspaceManager;
  flowsDir: string;
  knownProviders: ReadonlySet<string>;
  stepExecutorRegistry: StepExecutorRegistry;
  eventBus: EventBus;
}

function makeParams(overrides: Partial<FlowRegistrarParams> = {}): FlowRegistrarParams {
  const pi = overrides.pi ?? makeMockPi();
  const cmdRegistry =
    overrides.cmdRegistry ??
    ({ registerInstance: vi.fn().mockReturnValue(undefined) } as unknown as CommandRegistry);
  const toolRegistry =
    overrides.toolRegistry ??
    ({ registerInstance: vi.fn().mockReturnValue(undefined) } as unknown as ToolRegistry);
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
    workspaceManager: overrides.workspaceManager ?? ({} as WorkspaceManager),
    flowsDir: overrides.flowsDir ?? "/flows",
    knownProviders: overrides.knownProviders ?? new Set(),
    stepExecutorRegistry: overrides.stepExecutorRegistry ?? ({} as StepExecutorRegistry),
    eventBus: overrides.eventBus ?? makeMockEventBus(),
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "test-orchestrator" },
    routines: overrides.routines ?? {
      build: { params: [], steps: [] },
    },
    ...overrides,
  };
}

function setupSingleFlow() {
  readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
  accessMock.mockResolvedValue(undefined);
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
      accessMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const params = makeParams({ flowsDir: "/custom/flows" });
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
      accessMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const cmdRegistry = {
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Only flow-a and flow-b should be processed => 2 registerInstance calls
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(2);
    });

    it("skips directories without an orchestrator.md file", async () => {
      readdirMock.mockResolvedValue([
        { name: "valid-flow", isDirectory: () => true },
        { name: "no-md", isDirectory: () => true },
      ]);
      // valid-flow has orchestrator.md, no-md does not
      accessMock.mockImplementation(async (p: string) => {
        if (p.includes("no-md")) throw new Error("ENOENT");
      });
      flowLoaderLoadMock.mockResolvedValue(makeFlow());

      const cmdRegistry = {
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
    });

    it("skips flows that fail to load and logs a warning (non-Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "broken-flow", isDirectory: () => true }]);
      accessMock.mockResolvedValue(undefined);
      specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockRejectedValue("raw string error");

      const cmdRegistry = {
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
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
      accessMock.mockResolvedValue(undefined);
      specManagerLoadFromDirectoryMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockRejectedValue(new Error("Invalid JSON"));

      const cmdRegistry = {
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
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
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
      const pi = makeMockPi();
      const params = makeParams({ pi, cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
      // The command passed to registerInstance has handler method
      const registeredCmd = (cmdRegistry.registerInstance as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(registeredCmd).toHaveProperty("name", "/cmd");
      expect(registeredCmd).toHaveProperty("handler");
    });

    it("loads the orchestrator persona before constructing FlowLoader", async () => {
      setupSingleFlow();

      const params = makeParams();
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(specManagerLoadFromDirectoryMock).toHaveBeenCalledWith("/flows/my-flow");
      expect(flowLoaderCtorMock).toHaveBeenCalled();
    });

    it("passes knownSpecs and knownProviders to FlowLoader", async () => {
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      accessMock.mockResolvedValue(undefined);
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
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
    });

    it("handles RoutineTool registration failures gracefully (non-Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      accessMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({
          routines: {
            step1: { params: [], steps: [] },
          },
        }),
      );

      const toolRegistry = {
        registerInstance: vi.fn().mockImplementation(() => {
          throw Error("raw string failure");
        }),
      } as unknown as ToolRegistry;
      const params = makeParams({ toolRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      expect(toolRegistry.registerInstance).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register RoutineTool"),
        expect.any(Object),
      );

      warnSpy.mockRestore();
    });

    it("handles RoutineTool registration failures gracefully (Error throw)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      readdirMock.mockResolvedValue([{ name: "my-flow", isDirectory: () => true }]);
      accessMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockResolvedValue(
        makeFlow({
          routines: {
            step1: { params: [], steps: [] },
            step2: { params: [], steps: [] },
          },
        }),
      );

      let callCount = 0;
      const toolRegistry = {
        registerInstance: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) throw new Error("Duplicate tool");
          return undefined;
        }),
      } as unknown as ToolRegistry;
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
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // No flows to process, no commands registered
      expect(cmdRegistry.registerInstance).not.toHaveBeenCalled();
    });

    it("registers orchestrator commands even when a flow has no routines", async () => {
      readdirMock.mockResolvedValue([{ name: "empty-flow", isDirectory: () => true }]);
      accessMock.mockResolvedValue(undefined);
      flowLoaderLoadMock.mockResolvedValue(makeFlow({ routines: {} }));

      const cmdRegistry = {
        registerInstance: vi.fn().mockReturnValue(undefined),
      } as unknown as CommandRegistry;
      const params = makeParams({ cmdRegistry });
      const registrar = new FlowRegistrar(params);
      await registrar.registerAll();

      // Command registered, but no tools (no routines to iterate over)
      expect(cmdRegistry.registerInstance).toHaveBeenCalledTimes(1);
    });
  });
});

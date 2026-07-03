/**
 * Test helpers for feature-forge.
 *
 * Provides reusable factories, builders, and assertion utilities.
 * NOTE: Do NOT create vi.mock-related state here — mock state must be
 * created via vi.hoisted() in each test file to avoid TDZ issues with
 * vi.mock hoisting.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

import { SpecManager, SpecResolutionParams } from "./agents";
import { type ExecuteTaskOptions, SubprocessAgent } from "./agents/agents/SubprocessAgent";
import { AgentStatus } from "./agents/base/AgentStatus";
import { AgentFactory } from "./agents/factories/AgentFactory";
import {
  AgentSpecification,
  AgentSpecificationParams,
} from "./agents/specifications/AgentSpecification";
import { WorkspaceHandle } from "./workspace/WorkspaceHandle";
import { WorkspaceProvider } from "./workspace/WorkspaceProvider";
import { WorktreeRegistry } from "./workspace/WorktreeRegistry";

// ---------------------------------------------------------------------------
// AgentSpecification builder
// ---------------------------------------------------------------------------

export function makeSpec(
  id: string,
  overrides: Partial<{
    role: string;
    systemPrompt: string;
    tools: readonly string[];
    model: string;
    ephemeral: boolean;
  }> = {},
): AgentSpecification {
  return new (class extends AgentSpecification {
    constructor() {
      super({
        id,
        role: overrides.role ?? "test",
        systemPrompt: overrides.systemPrompt ?? "You are a test agent.",
        tools: overrides.tools,
        model: overrides.model,
        ephemeral: overrides.ephemeral,
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// Mock Agent (does not rely on RpcClient)
// ---------------------------------------------------------------------------

export class MockAgent extends SubprocessAgent {
  public readonly specification: AgentSpecification;
  public status: AgentStatus = AgentStatus.Spawned;
  public lastPrompt: string = "";

  private _result = "";
  private _error: Error | undefined;

  constructor(
    public readonly id: string,
    overrides: { role?: string; status?: AgentStatus } = {},
  ) {
    super();
    this.id = id;
    this.status = overrides.status ?? AgentStatus.Spawned;
    this.specification = makeSpec(id, { role: overrides.role ?? "mock" });
  }

  override async start(): Promise<void> {
    this.status = AgentStatus.Running;
  }

  override async executeTask(prompt: string, _options?: ExecuteTaskOptions): Promise<string> {
    this.lastPrompt = prompt;
    this.status = AgentStatus.Running;
    this._result = `result for: ${prompt}`;
    this.status = AgentStatus.Completed;
    return this._result;
  }

  async destroy(): Promise<void> {
    this.status = AgentStatus.Cancelled;
  }

  getResult(): string {
    if (this.status !== AgentStatus.Completed) throw new Error("Not completed");
    return this._result;
  }

  getError(): Error | undefined {
    if (this.status !== AgentStatus.Failed && this.status !== AgentStatus.Cancelled) {
      throw new Error("Not failed/cancelled");
    }
    return this._error;
  }

  setError(error: Error): void {
    this._error = error;
    this.status = AgentStatus.Failed;
  }

  deliverResult(_prompt: string, _result: string, _pi: ExtensionAPI): void {}
  deliverError(_prompt: string, _error: Error, _pi: ExtensionAPI): void {}
}

// ---------------------------------------------------------------------------
// Mock AgentFactory
// ---------------------------------------------------------------------------

export function makeMockFactory(): AgentFactory {
  const mockCreate: AgentFactory["create"] = vi
    .fn()
    .mockImplementation(async (spec: AgentSpecification) => {
      const agent = new MockAgent(spec.id, { role: spec.role });
      agent.status = AgentStatus.Running;
      return agent;
    });
  return { create: mockCreate };
}

// ---------------------------------------------------------------------------
// Mock ExtensionAPI (pi)
// ---------------------------------------------------------------------------

export function makeMockPi(): ExtensionAPI {
  return {
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    setActiveTools: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
  } as unknown as ExtensionAPI;
}

// ---------------------------------------------------------------------------
// Mock ExtensionCommandContext
// ---------------------------------------------------------------------------

export function makeMockCtx(): ExtensionCommandContext {
  return {
    ui: { notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

// ---------------------------------------------------------------------------
// RpcClient mock builder (use inside vi.hoisted() in test files)
//
// Usage:
//   const rpcMock = createRpcClientMock();
//   vi.mock("@earendil-works/pi-coding-agent", () => rpcMock.factory());
//
//   beforeEach(() => { rpcMock.reset(); });
//   // Then access: rpcMock.instance.start / .stop / .promptAndWait
// ---------------------------------------------------------------------------

export interface RpcClientMock {
  readonly instance: ReturnType<ReturnType<typeof createRpcClientMock>["getInstance"]>;
  getInstance(): Record<string, ReturnType<typeof vi.fn>>;
  reset(): void;
  factory(): Record<string, unknown>;
}

export function createRpcClientMock(): RpcClientMock {
  let instance: Record<string, ReturnType<typeof vi.fn>>;

  function reset() {
    instance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      promptAndWait: vi.fn().mockResolvedValue([]),
    };
  }
  reset();

  function MockRpcClientConstructor() {
    return instance;
  }

  return {
    get instance() {
      return instance!;
    },
    getInstance: () => instance!,
    reset,
    factory: (): Record<string, unknown> => ({
      RpcClient: MockRpcClientConstructor,
      ExtensionAPI: class {},
      ExtensionCommandContext: class {},
      ExtensionContext: class {},
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock WorkspaceProvider (in-memory fake)
// ---------------------------------------------------------------------------

/**
 * In-memory workspace provider for unit tests.
 *
 * Creates and destroys workspaces as temporary directories under a
 * configurable base path. No filesystem or git dependency.
 */
export class MockWorkspaceProvider extends WorkspaceProvider {
  /** Tracks created workspaces by id. */
  public readonly workspaces = new Map<string, string>();
  /** If true, createWorkspace will throw. */
  public shouldFailCreation = false;
  /** If true, destroyWorkspace will throw. */
  public shouldFailDestruction = false;
  /** Optional error message for simulated failures. */
  public failureMessage = "Mock failure";

  constructor(
    /** Base path prepended to workspace ids to form paths. */
    public readonly basePath = "/tmp/mock-workspaces",
  ) {
    super();
  }

  override async createWorkspace(workspaceId: string): Promise<string> {
    if (this.shouldFailCreation) {
      throw new Error(this.failureMessage);
    }
    const path = `${this.basePath}/${workspaceId}`;
    this.workspaces.set(workspaceId, path);
    return path;
  }

  override async destroyWorkspace(path: string): Promise<void> {
    if (this.shouldFailDestruction) {
      throw new Error(this.failureMessage);
    }
    for (const [id, existingPath] of this.workspaces.entries()) {
      if (existingPath === path) {
        this.workspaces.delete(id);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mock WorktreeRegistry (in-memory fake, no file I/O)
// ---------------------------------------------------------------------------

/**
 * In-memory worktree registry for unit tests.
 *
 * Extends {@link WorkspaceRegistry} with zero file I/O — overrides
 * {@link load} and {@link persist} as no-ops.
 * Useful for testing commands and orchestrators that depend on the
 * registry without needing temporary JSON files.
 */
export class MockWorktreeRegistry extends WorktreeRegistry {
  constructor(dummyPath = "/tmp/mock-worktrees.json") {
    super(dummyPath);
  }

  override async load(): Promise<void> {
    // No-op: already in-memory
  }

  override async register(handle: WorkspaceHandle): Promise<void> {
    this.items.set(handle.path, handle);
  }

  override async remove(path: string): Promise<void> {
    this.items.delete(path);
  }

  get(path: string): WorkspaceHandle | undefined {
    return this.items.get(path);
  }

  list(): WorkspaceHandle[] {
    return Array.from(this.items.values());
  }

  /** Clear all entries (for test setup/teardown). */
  clear(): void {
    this.items.clear();
  }
}

// ---------------------------------------------------------------------------
// RPC message event builders
// ---------------------------------------------------------------------------

export function makeMockSocketClient() {
  return { request: vi.fn() };
}

export function makeMessageEvent(text: string): object {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

// ---------------------------------------------------------------------------
// Mock SpecManager (resolves any spec to a basic AgentSpecification)
// ---------------------------------------------------------------------------

export function makeMockSpecManager() {
  return {
    resolve: vi.fn().mockImplementation((params: SpecResolutionParams): AgentSpecification => {
      return {
        id: params.spec ?? params.role ?? "mock",
        role: params.role ?? "mock",
        systemPrompt: params.systemPrompt ?? "Mock system prompt",
        tools: params.tools ?? [],
        cwd: params.cwd,
        disableBuiltinTools: false,
        disableExtensions: false,
        disableSkills: false,
        disablePromptTemplates: false,
        disableContextFiles: false,
        ephemeral: false,
        excludedTools: [],
        model: undefined,
        thinkingLevel: undefined,
      } satisfies AgentSpecification;
    }),
    createDynamic: vi.fn().mockImplementation((params: AgentSpecificationParams) => {
      return {
        id: params.role,
        role: params.role,
        systemPrompt: params.systemPrompt,
        tools: params.tools ?? [],
        model: params.model,
        cwd: params.cwd,
        disableBuiltinTools: false,
        disableExtensions: false,
        disableSkills: false,
        disablePromptTemplates: false,
        disableContextFiles: false,
        ephemeral: false,
        excludedTools: [],
        thinkingLevel: undefined,
      } satisfies AgentSpecification;
    }),
  } as unknown as SpecManager;
}

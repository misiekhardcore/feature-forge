/**
 * Test helpers for feature-forge.
 *
 * Provides reusable factories, builders, and assertion utilities.
 * NOTE: Do NOT create vi.mock-related state here — mock state must be
 * created via vi.hoisted() in each test file to avoid TDZ issues with
 * vi.mock hoisting.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

import { Agent } from "./agents/agents/Agent";
import { AgentIdentifier } from "./agents/base/AgentIdentifier";
import { AgentStatus } from "./agents/base/AgentStatus";
import { AgentFactory } from "./agents/factories/AgentFactory";
import { AgentSpecification } from "./agents/specifications/AgentSpecification";

// ---------------------------------------------------------------------------
// AgentSpecification builder
// ---------------------------------------------------------------------------

export function makeSpec(
  id: string,
  overrides: Partial<{
    role: string;
    systemPrompt: string;
    toolNames: readonly string[];
    modelPreference: string;
    ephemeral: boolean;
  }> = {},
): AgentSpecification {
  return new (class extends AgentSpecification {
    constructor() {
      super({
        identifier: new AgentIdentifier(id),
        role: overrides.role ?? "test",
        systemPrompt: overrides.systemPrompt ?? "You are a test agent.",
        toolNames: overrides.toolNames,
        modelPreference: overrides.modelPreference,
        ephemeral: overrides.ephemeral,
      });
    }
  })();
}

// ---------------------------------------------------------------------------
// Mock Agent (does not rely on RpcClient)
// ---------------------------------------------------------------------------

export class MockAgent extends Agent {
  public readonly identifier: AgentIdentifier;
  public readonly specification: AgentSpecification;
  public status: AgentStatus = AgentStatus.Spawned;
  public lastTask: string = "";

  private _result = "";
  private _error: Error | undefined;

  constructor(id: string, overrides: { role?: string; status?: AgentStatus } = {}) {
    super();
    this.identifier = new AgentIdentifier(id);
    this.status = overrides.status ?? AgentStatus.Spawned;
    this.specification = makeSpec(id, { role: overrides.role ?? "mock" });
  }

  async executeTask(task: string): Promise<string> {
    this.lastTask = task;
    this.status = AgentStatus.Running;
    this._result = `result for: ${task}`;
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

  deliverResult(_task: string, _result: string, _pi: ExtensionAPI): void {}
  deliverError(_task: string, _error: Error, _pi: ExtensionAPI): void {}
}

// ---------------------------------------------------------------------------
// Mock AgentFactory
// ---------------------------------------------------------------------------

export function makeMockFactory(): AgentFactory {
  const mockCreate: AgentFactory["create"] = vi
    .fn()
    .mockImplementation(async (spec: AgentSpecification) => {
      const agent = new MockAgent(spec.identifier.toString(), { role: spec.role });
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
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as ExtensionAPI;
}

// ---------------------------------------------------------------------------
// Mock ExtensionCommandContext
// ---------------------------------------------------------------------------

export function makeMockCtx(): { ui: { notify: ReturnType<typeof vi.fn> } } {
  return {
    ui: { notify: vi.fn() },
  };
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
// RPC message event builders
// ---------------------------------------------------------------------------

export function makeMessageEvent(text: string): object {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

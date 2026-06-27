import { describe, expect, it } from "vitest";

import type { FlowContext } from "./FlowContext";
import type { WorkspaceInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

// ── Helpers ──────────────────────────────────────────────────

class FakeExecutor extends StepExecutor {
  readonly type: string;
  private readonly resultId: string;

  constructor(type: string, resultId = "r") {
    super();
    this.type = type;
    this.resultId = resultId;
  }

  async execute(instruction: WorkspaceInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(this.resultId, { raw: `executed ${this.type}` });
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("StepExecutorRegistry", () => {
  describe("register", () => {
    it("registers an executor and makes it retrievable", () => {
      const registry = new StepExecutorRegistry();
      const executor = new FakeExecutor("workspace");
      registry.register(executor);
      expect(registry.get("workspace")).toBe(executor);
    });

    it("returns this for chaining", () => {
      const registry = new StepExecutorRegistry();
      const result = registry.register(new FakeExecutor("a"));
      expect(result).toBe(registry);
    });

    it("throws when registering a duplicate type", () => {
      const registry = new StepExecutorRegistry();
      registry.register(new FakeExecutor("dup"));
      expect(() => registry.register(new FakeExecutor("dup"))).toThrow(
        "Step executor already registered",
      );
    });
  });

  describe("get", () => {
    it("returns undefined for an unregistered type", () => {
      const registry = new StepExecutorRegistry();
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("returns the executor for a registered type", () => {
      const registry = new StepExecutorRegistry();
      const executor = new FakeExecutor("loop");
      registry.register(executor);
      expect(registry.get("loop")).toBe(executor);
    });
  });

  describe("has", () => {
    it("returns true for a registered type", () => {
      const registry = new StepExecutorRegistry();
      registry.register(new FakeExecutor("agent"));
      expect(registry.has("agent")).toBe(true);
    });

    it("returns false for an unregistered type", () => {
      const registry = new StepExecutorRegistry();
      expect(registry.has("agent")).toBe(false);
    });
  });

  describe("types", () => {
    it("returns an empty set when nothing is registered", () => {
      const registry = new StepExecutorRegistry();
      expect(registry.types().size).toBe(0);
    });

    it("returns all registered type names", () => {
      const registry = new StepExecutorRegistry();
      registry.register(new FakeExecutor("workspace"));
      registry.register(new FakeExecutor("agent"));
      expect(registry.types()).toEqual(new Set(["workspace", "agent"]));
    });

    it("returns a snapshot (adding later does not mutate the returned set)", () => {
      const registry = new StepExecutorRegistry();
      registry.register(new FakeExecutor("a"));
      const types = registry.types();
      registry.register(new FakeExecutor("b"));
      expect(types.size).toBe(1);
    });
  });
});

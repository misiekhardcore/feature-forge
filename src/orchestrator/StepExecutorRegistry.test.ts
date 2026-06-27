import { describe, expect, it } from "vitest";

import { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

class TestExecutor extends StepExecutor {
  readonly type: string;
  constructor(type: string) {
    super();
    this.type = type;
  }

  override async execute(
    _instruction: FlowInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    return context;
  }
}

describe("StepExecutorRegistry", () => {
  describe("register", () => {
    it("registers an executor and makes it findable", () => {
      const registry = new StepExecutorRegistry();
      const executor = new TestExecutor("agent");
      registry.register(executor);

      expect(registry.has("agent")).toBe(true);
      expect(registry.find("agent")).toBe(executor);
    });

    it("throws when registering a duplicate type", () => {
      const registry = new StepExecutorRegistry();
      registry.register(new TestExecutor("agent"));

      expect(() => registry.register(new TestExecutor("agent"))).toThrow(
        "Step executor already registered for type: agent",
      );
    });
  });

  describe("registerAll", () => {
    it("registers multiple executors at once", () => {
      const registry = new StepExecutorRegistry();
      const agent = new TestExecutor("agent");
      const parallel = new TestExecutor("parallel");

      registry.registerAll(agent, parallel);

      expect(registry.has("agent")).toBe(true);
      expect(registry.has("parallel")).toBe(true);
      expect(registry.find("agent")).toBe(agent);
      expect(registry.find("parallel")).toBe(parallel);
    });

    it("returns the registry for chaining", () => {
      const registry = new StepExecutorRegistry();
      const result = registry.registerAll(new TestExecutor("agent"));

      expect(result).toBe(registry);
    });
  });

  describe("find", () => {
    it("returns undefined for an unregistered type", () => {
      const registry = new StepExecutorRegistry();

      expect(registry.find("nonexistent")).toBeUndefined();
    });
  });

  describe("has", () => {
    it("returns false for an unregistered type", () => {
      const registry = new StepExecutorRegistry();

      expect(registry.has("nonexistent")).toBe(false);
    });
  });
});

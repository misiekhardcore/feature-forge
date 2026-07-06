import { describe, expect, it } from "vitest";

import { makeMockEventBus } from "../test-utils";
import type { FlowDefinition } from "./FlowInstruction";
import { FLOW_SCHEMA_URL } from "./FlowInstruction";
import { RuntimeCapabilities } from "./RuntimeCapabilities";
import type { StepExecutorRegistry } from "./StepExecutorRegistry";

// ── Helpers ──────────────────────────────────────────────────

function makeTestFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "test-orchestrator" },
    routines: {
      build: { params: [], steps: [] },
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("RuntimeCapabilities", () => {
  describe("construction", () => {
    it("stores the event bus", () => {
      const eventBus = makeMockEventBus();
      const caps = new RuntimeCapabilities(eventBus, {} as StepExecutorRegistry, new Map());

      expect(caps.eventBus).toBe(eventBus);
    });

    it("stores the step executor registry", () => {
      const registry = {} as StepExecutorRegistry;
      const caps = new RuntimeCapabilities(makeMockEventBus(), registry, new Map());

      expect(caps.stepExecutorRegistry).toBe(registry);
    });

    it("stores the flows map", () => {
      const flows = new Map<string, FlowDefinition>();
      const flow = makeTestFlow({ command: "/cmd" });
      flows.set("/cmd", flow);
      const caps = new RuntimeCapabilities(makeMockEventBus(), {} as StepExecutorRegistry, flows);

      expect(caps.flows.get("/cmd")!.command).toBe("/cmd");
    });

    it("accepts an empty flows map", () => {
      const caps = new RuntimeCapabilities(
        makeMockEventBus(),
        {} as StepExecutorRegistry,
        new Map(),
      );

      expect(caps.flows.size).toBe(0);
    });
  });

  describe("flows map mutability", () => {
    it("allows adding flows after construction", () => {
      const flows = new Map<string, FlowDefinition>();
      const caps = new RuntimeCapabilities(makeMockEventBus(), {} as StepExecutorRegistry, flows);

      const flow = makeTestFlow({ command: "/added" });
      flows.set("/added", flow);

      expect(caps.flows.get("/added")).toBe(flow);
      expect(caps.flows.size).toBe(1);
    });

    it("allows looking up a flow by command name", () => {
      const flows = new Map<string, FlowDefinition>();
      const flow1 = makeTestFlow({ command: "/cmd1", name: "flow1" });
      const flow2 = makeTestFlow({ command: "/cmd2", name: "flow2" });
      flows.set("/cmd1", flow1);
      flows.set("/cmd2", flow2);

      const caps = new RuntimeCapabilities(makeMockEventBus(), {} as StepExecutorRegistry, flows);

      expect(caps.flows.get("/cmd1")).toBe(flow1);
      expect(caps.flows.get("/cmd2")).toBe(flow2);
      expect(caps.flows.get("/nonexistent")).toBeUndefined();
    });
  });
});

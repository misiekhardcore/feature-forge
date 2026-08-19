import { describe, expect, it } from "vitest";

import { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import { FlowStateStore } from "./FlowStateStore";

describe("ActiveFlowRegistry", () => {
  it("starts with no active flow", () => {
    const registry = new ActiveFlowRegistry();
    expect(registry.getStore()).toBeUndefined();
    expect(registry.currentFlowName).toBeUndefined();
  });

  it("returns the store of the registered flow", () => {
    const registry = new ActiveFlowRegistry();
    const store = new FlowStateStore();

    registry.setCurrent("implement", store);

    expect(registry.getStore()).toBe(store);
    expect(registry.currentFlowName).toBe("implement");
  });

  it("overwrites the active flow on a second registration (most recent wins)", () => {
    const registry = new ActiveFlowRegistry();
    const firstStore = new FlowStateStore();
    const secondStore = new FlowStateStore();

    registry.setCurrent("implement", firstStore);
    registry.setCurrent("review", secondStore);

    expect(registry.getStore()).toBe(secondStore);
    expect(registry.currentFlowName).toBe("review");
  });

  it("clears the active flow", () => {
    const registry = new ActiveFlowRegistry();
    registry.setCurrent("implement", new FlowStateStore());

    registry.clear();

    expect(registry.getStore()).toBeUndefined();
    expect(registry.currentFlowName).toBeUndefined();
  });
});

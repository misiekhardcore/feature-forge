import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import { FlowStateStore } from "@feature-forge/core/flows";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import { makeMockTypedEventBus } from "../test-utils";
import { SetFlowParamTool } from "./SetFlowParamTool";

describe("SetFlowParamTool", () => {
  it("has name 'set_flow_param'", () => {
    const tool = new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus());
    expect(tool.name).toBe("set_flow_param");
  });

  it("has a label", () => {
    const tool = new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus());
    expect(tool.label).toBe("Set Flow Param");
  });

  it("has a description", () => {
    const tool = new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus());
    expect(tool.description).toBeTruthy();
  });

  it("runs in the current session (renderShell 'self')", () => {
    const tool = new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus());
    expect(tool.renderShell).toBe("self");
  });

  it("defines parameters requiring a non-empty key", () => {
    const tool = new SetFlowParamTool(new ActiveFlowRegistry(), makeMockTypedEventBus());
    expect(Value.Check(tool.parameters, { key: "workspace", value: "/path" })).toBe(true);
    expect(Value.Check(tool.parameters, { key: "", value: "x" })).toBe(false);
    expect(Value.Check(tool.parameters, {})).toBe(false);
  });

  describe("execute", () => {
    function makeTool(activeFlow: ActiveFlowRegistry) {
      const eventBus = makeMockTypedEventBus();
      return { tool: new SetFlowParamTool(activeFlow, eventBus), eventBus };
    }

    it("writes the param into the active flow's store", async () => {
      const store = new FlowStateStore();
      const registry = new ActiveFlowRegistry();
      registry.setCurrent("implement", store);
      const { tool } = makeTool(registry);

      await tool.execute("call-1", { key: "workspace", value: "/path" }, undefined);

      expect(store.get("workspace")).toBe("/path");
    });

    it("returns a confirmation message with the key and value", async () => {
      const registry = new ActiveFlowRegistry();
      registry.setCurrent("implement", new FlowStateStore());
      const { tool } = makeTool(registry);

      const result = await tool.execute("call-1", { key: "workspace", value: "/path" }, undefined);

      expect(result).toEqual({
        content: [{ type: "text", text: "Session param set: workspace: /path" }],
        details: undefined,
      });
    });

    it("emits feature-forge:session-set on the event bus", async () => {
      const registry = new ActiveFlowRegistry();
      registry.setCurrent("implement", new FlowStateStore());
      const { tool, eventBus } = makeTool(registry);

      await tool.execute("call-1", { key: "workspace", value: "/path" }, undefined);

      expect(eventBus.raw.emit).toHaveBeenCalledWith(
        "feature-forge:session-set",
        expect.objectContaining({
          phase: "session-set",
          details: { key: "workspace", value: "/path" },
        }),
      );
    });

    it("rejects when no flow is active", async () => {
      const { tool } = makeTool(new ActiveFlowRegistry());

      await expect(
        tool.execute("call-1", { key: "workspace", value: "/path" }, undefined),
      ).rejects.toThrow(/no active flow/);
    });

    it("does not emit session-set when no flow is active", async () => {
      const { tool, eventBus } = makeTool(new ActiveFlowRegistry());

      await expect(
        tool.execute("call-1", { key: "workspace", value: "/path" }, undefined),
      ).rejects.toThrow(/no active flow/);

      expect(eventBus.raw.emit).not.toHaveBeenCalledWith(
        "feature-forge:session-set",
        expect.anything(),
      );
    });

    it("throws AbortError when the signal is already aborted", async () => {
      const { tool } = makeTool(new ActiveFlowRegistry());
      const controller = new AbortController();
      controller.abort();

      const error = await tool
        .execute("call-1", { key: "workspace", value: "/path" }, controller.signal)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
    });
  });
});

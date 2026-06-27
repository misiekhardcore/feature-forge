import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { beforeEach, describe, expect, it } from "vitest";

import { makeMockPi } from "../test-utils";
import { Tool } from "../tools/Tool";
import { ToolRegistry } from "./ToolRegistry";

class TestTool extends Tool {
  readonly name = "test-tool";
  readonly label = "Test Tool";
  readonly description = "A test tool";
  readonly parameters = Type.Object({ key: Type.String() });

  async execute(): Promise<AgentToolResult<unknown>> {
    return Promise.resolve({ content: [{ type: "text", text: "ok" }], details: {} });
  }
}

class SecondTool extends Tool {
  readonly name = "second-tool";
  readonly label = "Second Tool";
  readonly description = "Second tool";
  readonly parameters = Type.Object({});

  async execute(): Promise<AgentToolResult<unknown>> {
    return Promise.resolve({ content: [{ type: "text", text: "ok" }], details: {} });
  }
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(null, makeMockPi());
  });

  describe("register", () => {
    it("registers a tool and makes it retrievable", () => {
      const tool = registry.register(TestTool);
      expect(tool).toBeInstanceOf(TestTool);
      expect(registry.get("test-tool")).toBe(tool);
    });

    it("throws when registering a tool with a duplicate name", () => {
      registry.register(TestTool);
      expect(() => registry.register(TestTool)).toThrow("Tool already registered: test-tool");
    });
  });

  describe("registerAll", () => {
    it("registers multiple tools", () => {
      const tools = registry.registerAll(TestTool, SecondTool);
      expect(tools).toHaveLength(2);
      expect(registry.has("test-tool")).toBe(true);
      expect(registry.has("second-tool")).toBe(true);
    });

    it("throws on duplicate in registerAll", () => {
      registry.register(TestTool);
      expect(() => registry.registerAll(TestTool, SecondTool)).toThrow(
        "Tool already registered: test-tool",
      );
    });
  });

  describe("inherited registry features", () => {
    it("reports correct size", () => {
      expect(registry.size).toBe(0);
      registry.register(TestTool);
      expect(registry.size).toBe(1);
      registry.register(SecondTool);
      expect(registry.size).toBe(2);
    });

    it("unregister removes tool", () => {
      registry.register(TestTool);
      registry.unregister("test-tool");
      expect(registry.has("test-tool")).toBe(false);
    });

    it("registerInstance throws on duplicate", () => {
      const instance = new TestTool();
      registry.registerInstance(instance);
      expect(() => registry.registerInstance(instance)).toThrow("already registered");
    });
  });
});

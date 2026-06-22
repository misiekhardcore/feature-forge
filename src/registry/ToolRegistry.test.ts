import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "./ToolRegistry";
import type { ToolDeps } from "./ToolDeps";
import { Tool, ToolExecuteResult } from "../tools/Tool";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

class TestTool extends Tool {
  readonly name = "test-tool";
  readonly description = "A test tool";

  constructor(_deps: ToolDeps) {
    super();
  }

  async execute(args: Record<string, unknown>, _ctx: ExtensionContext): Promise<ToolExecuteResult> {
    return { success: true, data: args };
  }
}

class SecondTool extends Tool {
  readonly name = "second-tool";
  readonly description = "Second tool";

  constructor(_deps: ToolDeps) {
    super();
  }

  async execute(
    _args: Record<string, unknown>,
    _ctx: ExtensionContext,
  ): Promise<ToolExecuteResult> {
    return { success: true };
  }
}

describe("ToolRegistry", () => {
  let deps: ToolDeps;
  let registry: ToolRegistry;

  beforeEach(() => {
    deps = { pi: {} as never };
    registry = new ToolRegistry(deps);
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
      const tools = registry.registerAll([TestTool, SecondTool]);
      expect(tools).toHaveLength(2);
      expect(registry.has("test-tool")).toBe(true);
      expect(registry.has("second-tool")).toBe(true);
    });

    it("throws on duplicate in registerAll", () => {
      registry.register(TestTool);
      expect(() => registry.registerAll([TestTool, SecondTool])).toThrow(
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
  });

  describe("tool execution", () => {
    it("executes tool via registered instance", async () => {
      const tool = registry.register(TestTool);
      const result = await tool.execute({ key: "value" }, {} as ExtensionContext);
      expect(result).toEqual({ success: true, data: { key: "value" } });
    });
  });
});

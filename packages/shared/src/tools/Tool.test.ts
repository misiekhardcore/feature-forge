import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";

import { Tool } from "./Tool";

class NoOpTool extends Tool {
  readonly name = "noop";
  readonly label = "No-Op";
  readonly description = "Does nothing";
  readonly parameters = {} as TSchema;

  async execute(
    _toolCallId: string,
    _params: TSchema,
    _signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback | undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>> {
    return { content: [], details: undefined };
  }
}

describe("Tool", () => {
  it("can be subclassed with all required abstract members", () => {
    const tool = new NoOpTool();
    expect(tool.name).toBe("noop");
    expect(tool.label).toBe("No-Op");
    expect(tool.description).toBe("Does nothing");
    expect(tool.parameters).toBeDefined();
  });

  it("execute returns a result object", async () => {
    const tool = new NoOpTool();
    const result = await tool.execute("call-1", {}, undefined, undefined, {} as ExtensionContext);
    expect(result).toEqual({ content: [], details: undefined });
  });
});

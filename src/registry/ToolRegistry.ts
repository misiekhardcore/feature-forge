import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { ChildSocketClient } from "../ipc";
import { Tool } from "../tools";
import { Registry } from "./Registry";

export class ToolRegistry extends Registry<Tool> {
  constructor(
    private readonly client: ChildSocketClient | null,
    private readonly pi: ExtensionAPI,
  ) {
    super();
  }

  register(constructor: new (client: ChildSocketClient | null) => Tool): Tool {
    const tool = new constructor(this.client);
    if (this.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.set(tool.name, tool);
    this.pi.registerTool(tool);
    return tool;
  }

  /**
   * Register an already-constructed tool instance.
   *
   * Used by RoutineTool and other tools that are created by
   * external factories rather than the constructor pattern.
   * Casts through unknown to satisfy ToolRegistry's Tool type constraint.
   */
  registerInstance(tool: ToolDefinition): Tool {
    const name = tool.name;
    if (this.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    const cast = tool as unknown as Tool;
    this.set(name, cast);
    this.pi.registerTool(cast);
    return cast;
  }

  registerAll(...constructors: (new (client: ChildSocketClient | null) => Tool)[]): Tool[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

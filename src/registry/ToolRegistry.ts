import { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
    if (this.items.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.items.set(tool.name, tool);
    this.pi.registerTool(tool);
    return tool;
  }

  registerAll(...constructors: (new (client: ChildSocketClient | null) => Tool)[]): Tool[] {
    return constructors.map((constructor) => this.register(constructor));
  }
}

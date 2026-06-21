import { Registry } from "./Registry";
import type { ToolDeps } from "./ToolDeps";
import { Tool } from "../tools";

type ToolConstructor = new (deps: ToolDeps) => Tool;

export class ToolRegistry extends Registry<Tool> {
  constructor(private deps: ToolDeps) {
    super();
  }

  register(ctor: ToolConstructor): Tool {
    const instance = new ctor(this.deps);
    if (this.items.has(instance.name)) {
      throw new Error(`Tool already registered: ${instance.name}`);
    }
    this.items.set(instance.name, instance);
    return instance;
  }

  registerAll(ctors: ToolConstructor[]): Tool[] {
    return ctors.map((ctor) => this.register(ctor));
  }
}

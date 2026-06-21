import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { InMemoryAgentSupervisor } from "../agents/supervisors";

export interface CommandDeps {
  supervisor: InMemoryAgentSupervisor;
  pi: ExtensionAPI;
}

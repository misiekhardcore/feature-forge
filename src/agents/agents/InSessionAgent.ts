import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { Agent } from "./Agent";

/**
 * Intermediate base for agents that run *inside* the current pi session.
 *
 * Unlike {@link SubprocessAgent}, an in-session agent drives the live
 * conversation across multiple turns and has no discrete awaited string to
 * return. Its interaction contract is therefore {@link mount}: inject the
 * persona + resolved task into the current session via the pi SDK.
 *
 * @see docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md
 */
export abstract class InSessionAgent extends Agent {
  /**
   * Inject the persona and resolved task into the live pi session.
   *
   * Symmetric to `SubprocessAgent.executeTask(prompt)`: both take the
   * *resolved* task string at execution time. The orchestrator prompt
   * template (`flow.orchestrator.prompt` + `promptParams`) is resolved to a
   * plain `task` string by the command layer *before* mount, so the routine
   * engine's execution-context type never reaches the agent surface.
   *
   * Transitions {@link status} from {@link AgentStatus.Spawned} to
   * {@link AgentStatus.Running}.
   */
  public abstract mount(pi: ExtensionAPI, task: string): void;
}

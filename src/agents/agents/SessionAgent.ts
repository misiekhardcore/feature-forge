import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import { AgentStatus } from "../base";
import type { AgentSpecification } from "../specifications";
import { InSessionAgent } from "./InSessionAgent";

/** The `before_agent_start` handler shape registered on mount. */
type BeforeAgentStartHandler = (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult;

/**
 * pi may expose an `off` deregistration method at runtime even though it is
 * not part of the published {@link ExtensionAPI} interface. We probe for it
 * defensively so `destroy()` is a no-op when the SDK lacks deregistration.
 */
type DeregisterablePi = ExtensionAPI & {
  off?(event: "before_agent_start", handler: BeforeAgentStartHandler): void;
};

/**
 * Concrete in-session agent: an LLM persona loaded into the *current* pi
 * conversation.
 *
 * Constructed from an {@link AgentSpecification} (the unified persona-input
 * type, shared with its subprocess sibling) and mounted into the live session
 * via {@link mount}. Its persona content happens to read "you are the
 * /implement orchestrator" — but the class is role-neutral; a future
 * non-orchestrator in-session persona reuses it.
 *
 * Formerly `OrchestratorAgent`. The "Orchestrator" name continues to belong to
 * the deterministic flow-follower (`RoutineExecutor`/`StepExecutor`).
 *
 * @see docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md
 */
export class SessionAgent extends InSessionAgent {
  public readonly id: string;
  public readonly specification: AgentSpecification;

  private _status: AgentStatus = AgentStatus.Spawned;
  private pi: ExtensionAPI | undefined;
  private handler: BeforeAgentStartHandler | undefined;

  constructor(specification: AgentSpecification) {
    super();
    this.id = specification.id;
    this.specification = specification;
  }

  public get status(): AgentStatus {
    return this._status;
  }

  /**
   * Inject the persona + resolved task into the current session.
   *
   * 1. Register a `before_agent_start` hook that appends the persona as a
   *    custom system prompt.
   * 2. Send the resolved task as a user message to trigger a turn.
   * 3. Apply the declared active tools (when any are specified).
   *
   * Transitions {@link status} from {@link AgentStatus.Spawned} to
   * {@link AgentStatus.Mounted}.
   */
  public override mount(pi: ExtensionAPI, task: string): void {
    this.pi = pi;
    this._status = AgentStatus.Mounted;

    this.handler = (event) => ({
      systemPrompt:
        event.systemPrompt +
        "\n\n---\n\n## Custom system prompt\n\n" +
        this.specification.systemPrompt,
    });
    pi.on("before_agent_start", this.handler);

    pi.sendUserMessage(task);

    if (this.specification.tools.length > 0) {
      pi.setActiveTools([...this.specification.tools]);
    }
  }

  /**
   * Deregister the `before_agent_start` hook (when the SDK supports it) and
   * end this agent's participation in the live session.
   *
   * Transitions {@link status} from {@link AgentStatus.Mounted} to
   * {@link AgentStatus.Cancelled}.
   */
  public override async destroy(): Promise<void> {
    if (this.pi && this.handler) {
      const deregisterable = this.pi as DeregisterablePi;
      if (typeof deregisterable.off === "function") {
        try {
          deregisterable.off("before_agent_start", this.handler);
        } catch (error) {
          logger.warn("Failed to deregister before_agent_start hook", { agentId: this.id, error });
        }
      }
    }
    this.handler = undefined;
    this._status = AgentStatus.Cancelled;
  }
}

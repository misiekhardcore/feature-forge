import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import { logger } from "@feature-forge/shared";
import type { AgentSpecification } from "../specifications";
import { InSessionAgent } from "./InSessionAgent";

/** The `before_agent_start` handler shape registered on mount. */
type BeforeAgentStartHandler = (event: BeforeAgentStartEvent) => BeforeAgentStartEventResult;

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
  private unmounted = true;
  private defaultTools: string[] = [];

  constructor(specification: AgentSpecification) {
    super();
    this.id = specification.id;
    this.specification = specification;
  }

  public get status(): AgentStatus {
    return this._status;
  }

  /** Whether the agent is currently mounted and injecting its persona. */
  public get isMounted(): boolean {
    return !this.unmounted;
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
   * {@link AgentStatus.Running}.
   */
  public override mount(pi: ExtensionAPI, task: string): void {
    this.pi = pi;
    this._status = AgentStatus.Running;
    this.unmounted = false;

    // Save default tools before the flow overrides them.
    this.defaultTools = [...pi.getActiveTools()];

    // pi SDK has no pi.off() — the handler cannot be removed once registered.
    // Instead we use an internal flag so the handler returns undefined (no-op)
    // after unmount() is called, suppressing persona injection.
    this.handler = (event) => {
      if (this.unmounted) return {};
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\n---\n\n## Custom system prompt\n\n" +
          this.specification.systemPrompt,
      };
    };
    pi.on("before_agent_start", this.handler);

    pi.sendUserMessage(task);

    if (this.specification.tools.length > 0) {
      pi.setActiveTools([...this.specification.tools]);
    }
  }

  /**
   * Stop injecting the persona into the system prompt and restore the
   * default tools that were active before {@link mount}.
   *
   * Because the pi SDK does not yet support `pi.off()`, the
   * `before_agent_start` handler is disabled via an internal flag
   * instead of being removed.
   *
   * Transitions {@link status} from {@link AgentStatus.Running} to
   * {@link AgentStatus.Cancelled}.
   */
  public unmount(): void {
    this.unmounted = true;
    if (this.pi) {
      this.pi.setActiveTools(this.defaultTools);
    }
    this._status = AgentStatus.Cancelled;
    logger.info(`Agent ${this.specification.id} unmounted`);
  }

  /**
   * Deregister the `before_agent_start` hook (when the SDK supports it) and
   * end this agent's participation in the live session.
   *
   * Transitions {@link status} from {@link AgentStatus.Running} to
   * {@link AgentStatus.Cancelled}.
   */
  public override async destroy(): Promise<void> {
    this.unmount();
    logger.info(`Agent ${this.specification.id} destroyed`);
  }
}

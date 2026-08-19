import { FlowStateStore } from "./FlowStateStore";

/**
 * Tracks the flow currently being driven by a mounted orchestrator persona.
 *
 * `set_flow_param` (and any other shared session-state surface) routes
 * through this registry so writes land in the ACTIVE flow's
 * {@link FlowStateStore} — not in whichever flow happened to register a
 * same-named tool first (the D1 collision).
 *
 * Single slot: the most recent mount wins (matches the C4 reality that
 * personas stay mounted and the latest flow command is the conversation
 * focus). Cleared on a successful /flow:exit.
 */
export class ActiveFlowRegistry {
  private current: { flowName: string; store: FlowStateStore } | undefined;

  /** Register `store` as the store of the currently active flow. */
  setCurrent(flowName: string, store: FlowStateStore): void {
    this.current = { flowName, store };
  }

  /** Forget the active flow (used by /flow:exit after a successful exit). */
  clear(): void {
    this.current = undefined;
  }

  /** The active flow's store, or undefined when no flow is mounted. */
  getStore(): FlowStateStore | undefined {
    return this.current?.store;
  }

  /** Name of the active flow (undefined when none) — diagnostics/debugging. */
  get currentFlowName(): string | undefined {
    return this.current?.flowName;
  }
}

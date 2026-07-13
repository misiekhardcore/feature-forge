import type { MutableState } from "./AccumulatedState";
import type { DisplayContribution } from "./DisplayContribution";

/**
 * Handler function that updates a {@link MutableState} from a single
 * {@link DisplayContribution}.
 *
 * @param contribution — The contribution to process.
 * @param state — The mutable accumulated state to update.
 */
export type DisplayHandler = (contribution: DisplayContribution, state: MutableState) => void;

/**
 * Registry mapping {@link DisplayContribution.type} values to handler
 * functions.
 *
 * Each step executor registers its own handler for the contribution type
 * it produces. When a set of contributions needs to be accumulated, the
 * registry dispatches each contribution to its type-specific handler.
 *
 * Usage:
 * ```ts
 * const registry = new DisplayContributionRegistry();
 * registry.register("agent", (c, s) => {
 *   if (c.type === "agent") s.agentMap.set(c.agentId, { ... });
 * });
 * registry.register("loop", (c, s) => {
 *   if (c.type === "loop") { s.iteration = c.iteration; ... }
 * });
 *
 * const state = createMutableState();
 * registry.apply(state, contributions);
 * ```
 */
export class DisplayContributionRegistry {
  private readonly handlers = new Map<string, DisplayHandler>();

  /**
   * Register a handler for a specific contribution type.
   *
   * @param type — The {@link DisplayContribution.type} value to handle.
   * @param handler — Function that updates the mutable state from a
   *   contribution of this type.
   */
  register(type: string, handler: DisplayHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Display handler already registered for type: ${type}`);
    }
    this.handlers.set(type, handler);
  }

  /**
   * Apply all contributions to the given mutable state, dispatching
   * each to its type-specific handler.
   *
   * Contributions whose type has no registered handler are silently
   * skipped.
   *
   * @param state — The mutable state to update.
   * @param contributions — Ordered array of contributions to process.
   */
  apply(state: MutableState, contributions: readonly DisplayContribution[]): void {
    for (const contribution of contributions) {
      const handler = this.handlers.get(contribution.type);
      if (handler) {
        handler(contribution, state);
      }
    }
  }

  /**
   * Check whether a handler is registered for the given type.
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * Return all registered type names.
   */
  types(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

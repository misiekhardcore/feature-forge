import type { AccumulatedState } from "./AccumulatedState";
import type { DisplayContribution } from "./DisplayContribution";

/**
 * Handler function that applies a single {@link DisplayContribution} to an
 * {@link AccumulatedState}.
 */
export type ContributionHandler = (
  state: AccumulatedState,
  contribution: DisplayContribution,
) => void;

/**
 * Generic dispatch registry for processing {@link DisplayContribution} records.
 *
 * Step executors register handlers per contribution type. The renderer
 * (or any consumer) calls {@link apply} to apply all accumulated contributions
 * to an {@link AccumulatedState}.
 *
 * The registry has no knowledge of contribution semantics — it only
 * dispatches to registered handlers based on the `type` discriminator.
 */
export class DisplayContributionRegistry {
  private readonly handlers = new Map<string, ContributionHandler>();

  /**
   * Register a handler for contributions with the given `type`.
   *
   * Later registrations overwrite earlier ones for the same type.
   */
  register(type: string, handler: ContributionHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Apply all registered contributions to the given state.
   *
   * Iterates `contributions` in order. For each contribution, looks up
   * the handler registered for `contribution.type` and calls it with
   * `state` and the contribution. Contributions whose type has no
   * registered handler are silently skipped.
   */
  apply(state: AccumulatedState, contributions: readonly DisplayContribution[]): void {
    for (const contribution of contributions) {
      const handler = this.handlers.get(contribution.type);
      if (handler) {
        handler(state, contribution);
      }
    }
  }
}

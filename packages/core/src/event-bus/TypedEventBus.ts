import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ForgeChannels } from "./channels";

/**
 * Typed wrapper around pi's untyped {@link EventBus}.
 *
 * Confines every {@code as} cast to this single file. All consumers
 * call the typed {@link on} and {@link emit} methods; all forge
 * channel payloads are validated against {@link ForgeChannels}.
 *
 * The underlying {@link raw} bus is exposed for passing to code that
 * expects the untyped {@link EventBus} interface (e.g. step executors).
 */
export class TypedEventBus {
  /** The raw pi EventBus — pass to code that requires the untyped interface. */
  readonly raw: EventBus;

  constructor(bus: EventBus) {
    this.raw = bus;
  }

  /**
   * Emit a typed payload on a forge channel.
   *
   * Only channels declared in {@link ForgeChannels} are accepted.
   * The payload shape is enforced at compile time.
   */
  emit<C extends keyof ForgeChannels>(channel: C, payload: ForgeChannels[C]): void {
    this.raw.emit(channel, payload);
  }

  /**
   * Subscribe to a forge channel with a typed handler.
   *
   * The handler receives the payload already narrowed to the
   * channel's declared type — no {@code as} cast needed.
   *
   * @returns An unsubscribe function.
   */
  on<C extends keyof ForgeChannels>(
    channel: C,
    handler: (payload: ForgeChannels[C]) => void,
  ): () => void {
    return this.raw.on(channel, handler as (data: unknown) => void);
  }
}

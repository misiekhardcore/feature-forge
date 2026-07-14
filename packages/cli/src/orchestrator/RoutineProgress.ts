import type { ForgeChannels } from "./eventBus/channels";

/**
 * A granular progress update emitted during routine execution.
 *
 * Each event is a discriminated union keyed by the literal `phase` string.
 * Narrow by checking `event.phase` to access the correct `details` shape.
 */
export type RoutineProgressEvent = ForgeChannels[keyof ForgeChannels];

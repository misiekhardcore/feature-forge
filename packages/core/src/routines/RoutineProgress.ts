// Type-only: elided at emit, zero runtime edge. Self-heals when cli/src/orchestrator/eventBus moves to core in S4d (#229).
import type { ForgeChannels } from "@feature-forge/cli/src/orchestrator/eventBus/channels";

/**
 * A granular progress update emitted during routine execution.
 *
 * Each event is a discriminated union keyed by the literal `phase` string.
 * Narrow by checking `event.phase` to access the correct `details` shape.
 */
export type RoutineProgressEvent = ForgeChannels[keyof ForgeChannels];

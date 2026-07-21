// @feature-forge/debug
//
// Dev-only test scenarios and commands.
// Scenarios are pure data factories for AgentViewerOverlay.
// Commands accept CLI-specific components via dependency interfaces
// to avoid importing @feature-forge/cli directly.

export type {
  RenderHelpers,
  TestLoopDeps,
  TestLoopScenarios,
  ViewerHandle,
  WidgetHandle,
} from "./commands/test-loop-routine.js";
export { registerTestLoopRoutine } from "./commands/test-loop-routine.js";
export {
  agentEndEvent,
  agentStartEvent,
  messageEndEvent,
  messageStartEvent,
  messageUpdateEvent,
  textDeltaEvent,
  toolExecutionEndEvent,
  toolExecutionStartEvent,
  turnEndEvent,
  turnStartEvent,
} from "./helpers/events.js";
export {
  assistantMsg,
  assistantStartMsg,
  textBlock,
  toolCall,
  toolResultMsg,
} from "./helpers/messages.js";
export type { ScenarioData } from "./scenarios/index.js";
export {
  builderScenario,
  conversationScenario,
  emptyScenario,
  errorScenario,
  manyTurnsScenario,
  reviewerScenario,
  toolArgsScenario,
} from "./scenarios/index.js";

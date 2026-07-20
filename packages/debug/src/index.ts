// @feature-forge/agent-viewer-test
//
// Pure data factories for AgentViewerOverlay test scenarios.
// No dependency on AgentViewerOverlay, @feature-forge/cli, or @feature-forge/shared.
// The cli extension imports these and wires them into actual overlays.

export type {
  RenderHelpers,
  TestLoopDeps,
  TestLoopScenarios,
  ThemeLike,
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

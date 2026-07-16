// @feature-forge/agent-viewer-test
//
// Pure data factories for AgentViewerOverlay test scenarios.
// No dependency on AgentViewerOverlay, @feature-forge/cli, or @feature-forge/shared.
// The cli extension imports these and wires them into actual overlays.

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
export { assistantMsg, textBlock, toolCall, toolResultMsg } from "./helpers/messages.js";
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

export { ActiveFlowRegistry } from "./ActiveFlowRegistry";
export type { FlowContextLike } from "./ExpressionEvaluator";
export { ExpressionEvaluator } from "./ExpressionEvaluator";
export type { BinaryOp, Expr, UnaryOp } from "./ExpressionParser";
export { ExpressionParser, ParseError } from "./ExpressionParser";
export type { InstructionResult } from "./FlowContext";
export { FlowContext } from "./FlowContext";
export type {
  AgentInstruction,
  CleanupInstruction,
  ContainerInstruction,
  FlowDefinition,
  FlowInstruction,
  GitInstruction,
  LoopInstruction,
  OrchestratorConfig,
  ParallelInstruction,
  RoutineDefinition,
  RoutineParam,
  SessionInstruction,
  ShellInstruction,
  WorkspaceInstruction,
} from "./FlowInstruction";
export {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  FLOW_SCHEMA_URL,
  FlowDefinitionSchema,
  FlowInstructionSchema,
  GitInstructionSchema,
  isContainerInstruction,
  isLoopInstruction,
  isParallelInstruction,
  LoopInstructionSchema,
  makeLoopInstruction,
  makeParallelInstruction,
  OrchestratorConfigSchema,
  ParallelInstructionSchema,
  RoutineParamSchema,
  SessionInstructionSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "./FlowInstruction";
export { FlowLoader } from "./FlowLoader";
export { type CreateRoutineTool, FlowRegistrar, type FlowRegistrarContext } from "./FlowRegistrar";
export type { FlowParams } from "./FlowStateStore";
export { FlowStateStore } from "./FlowStateStore";
export type { ResultPathFailure, ResultPathWalk } from "./ResultPathWalker";
export { ResultPathWalker } from "./ResultPathWalker";
export type { TemplateLookup } from "./TemplateResolver";
export { TemplateResolver } from "./TemplateResolver";

import {
  FlowInstructionSchema,
  LoopInstructionSchema as LoopInstructionSchemaBase,
  ParallelInstructionSchema as ParallelInstructionSchemaBase,
} from "./FlowInstruction";

export const LoopInstructionSchemaWithSteps =
  LoopInstructionSchemaBase as typeof LoopInstructionSchemaBase & {
    properties: { steps: typeof FlowInstructionSchema };
  };
export const ParallelInstructionSchemaWithSteps =
  ParallelInstructionSchemaBase as typeof ParallelInstructionSchemaBase & {
    properties: { steps: typeof FlowInstructionSchema };
  };

export type { ExpressionEvaluator, FlowContextLike } from "./ExpressionEvaluator";
export { BinaryOp, Expr, ExpressionParser, ParseError, UnaryOp } from "./ExpressionParser";
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
  ShellInstruction,
  WorkspaceInstruction,
} from "./FlowInstruction";
export {
  AgentInstructionSchema,
  CleanupInstructionSchema,
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
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "./FlowInstruction";
export { FlowLoader } from "./FlowLoader";
export type { RoutineResult } from "./RoutineResult";
export { StepExecutor } from "./StepExecutor";
export { StepExecutorRegistry } from "./StepExecutorRegistry";

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

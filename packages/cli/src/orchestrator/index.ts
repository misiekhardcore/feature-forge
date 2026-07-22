export { createStepExecutorRegistry } from "./createStepExecutorRegistry";
export {
  AgentStepExecutor,
  CleanupStepExecutor,
  GitStepExecutor,
  LoopStepExecutor,
  ParallelStepExecutor,
  SessionStepExecutor,
  ShellStepExecutor,
  WorkspaceStepExecutor,
} from "./executors";
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
export { FlowRegistrar } from "./FlowRegistrar";
export { RoutineExecutor } from "./RoutineExecutor";
export type { RoutineProgressEvent } from "./RoutineProgress";
export type { RoutineResult } from "./RoutineResult";
export { RoutineTool } from "./RoutineTool";
export { StepExecutor } from "./StepExecutor";
export { StepExecutorRegistry } from "./StepExecutorRegistry";
export type { DisplayContribution } from "@feature-forge/tui";
export type { AgentProgressStatus, ProgressEvent } from "@feature-forge/tui";
export type { BuildStatusLineParams, BuildWidgetLinesParams } from "@feature-forge/tui";
export type { ProgressSnapshot } from "@feature-forge/tui";
export type { RoutineProgressState } from "@feature-forge/tui";
export { NoOpProgressReporter } from "@feature-forge/tui";
export { ProgressRenderer } from "@feature-forge/tui";
export { EMPTY_PROGRESS_SNAPSHOT, ProgressReporter } from "@feature-forge/tui";

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

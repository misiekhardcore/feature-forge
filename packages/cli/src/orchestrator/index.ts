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
export type { DisplayContribution } from "./progress/DisplayContribution";
export { NoOpProgressReporter } from "./progress/NoOpProgressReporter";
export type { AgentProgressStatus, ProgressEvent } from "./progress/ProgressEvent";
export type { BuildStatusLineParams, BuildWidgetLinesParams } from "./progress/ProgressRenderer";
export { ProgressRenderer } from "./progress/ProgressRenderer";
export type { ProgressSnapshot } from "./progress/ProgressReporter";
export type { ProgressWidget } from "@feature-forge/tui";
export { EMPTY_PROGRESS_SNAPSHOT, ProgressReporter } from "./progress/ProgressReporter";
export type { RoutineProgressState } from "./progress/RoutineProgressState";
export { TuiRoutineWidget } from "@feature-forge/tui";
export { RoutineExecutor } from "./RoutineExecutor";
export type { RoutineProgressEvent } from "./RoutineProgress";
export type { RoutineResult } from "./RoutineResult";
export { RoutineTool } from "./RoutineTool";
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

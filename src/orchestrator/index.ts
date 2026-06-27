export { AgentStepExecutor } from "./AgentStepExecutor";
export { CleanupStepExecutor } from "./CleanupStepExecutor";
export type { ExpressionEvaluator, FlowContextLike } from "./ExpressionEvaluator";
export { BinaryOp, Expr, ExpressionParser, ParseError, UnaryOp } from "./ExpressionParser";
export { extractJson } from "./extractJson";
export type { InstructionResult } from "./FlowContext";
export { FlowContext } from "./FlowContext";
export type {
  AgentInstruction,
  CleanupInstruction,
  FlowDefinition,
  FlowInstruction,
  LoopInstruction,
  Orchestrator,
  ParallelInstruction,
  ShellInstruction,
  WorkspaceInstruction,
} from "./FlowInstruction";
export {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  FlowDefinitionSchema,
  FlowInstructionSchema,
  OrchestratorSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "./FlowInstruction";
export { FlowLoader } from "./FlowLoader";
export { collectAllIds, containerSteps } from "./helpers";
export { LoopStepExecutor } from "./LoopStepExecutor";
export { ParallelStepExecutor } from "./ParallelStepExecutor";
export { RoutineExecutor } from "./RoutineExecutor";
export type { RoutineResult } from "./RoutineResult";
export { isParsedResultPassed } from "./RoutineResult";
export { RoutineTool } from "./RoutineTool";
export { ShellStepExecutor } from "./ShellStepExecutor";
export { StepExecutor } from "./StepExecutor";
export { StepExecutorRegistry } from "./StepExecutorRegistry";
export { WorkspaceStepExecutor } from "./WorkspaceStepExecutor";

import {
  FlowInstructionSchema,
  LoopInstructionSchema as LoopInstructionSchemaBase,
  ParallelInstructionSchema as ParallelInstructionSchemaBase,
} from "./FlowInstruction";

const LoopInstructionSchema = LoopInstructionSchemaBase as typeof LoopInstructionSchemaBase & {
  properties: { steps: typeof FlowInstructionSchema };
};
const ParallelInstructionSchema =
  ParallelInstructionSchemaBase as typeof ParallelInstructionSchemaBase & {
    properties: { steps: typeof FlowInstructionSchema };
  };
export { LoopInstructionSchema, ParallelInstructionSchema };

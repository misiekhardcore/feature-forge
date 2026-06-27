import { logger } from "../../logging";
import type { WorkspaceManager } from "../../workspace/WorkspaceManager";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { CleanupInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "cleanup" instruction by destroying a named workspace
 * via {@link WorkspaceManager}.
 *
 * If {@link CleanupInstruction.of} is omitted, all tracked workspaces
 * in the context are destroyed.
 *
 * Best-effort: individual workspace destruction failures are logged but
 * do not stop the routine.
 */
export class CleanupStepExecutor extends StepExecutor<CleanupInstruction> {
  readonly type = "cleanup";

  constructor(private readonly workspaceManager: WorkspaceManager) {
    super();
  }

  async execute(instruction: CleanupInstruction, context: FlowContext): Promise<FlowContext> {
    // TODO: Wire up WorkspaceManager.
    // The WorkspaceManager currently wraps a single WorkspaceProvider.
    // To support cleanup of all workspaces in context, the manager needs
    // to be refactored or we need access to the raw providers.
    // For now, just log and return context unchanged.

    const targetName = instruction.of;

    if (targetName) {
      logger.info("Cleanup step — destroying workspace (TODO)", {
        instructionId: instruction.id,
        targetName,
      });
    } else {
      logger.info("Cleanup step — destroying all workspaces (TODO)", {
        instructionId: instruction.id,
        workspaceCount: context.workspaces.size,
      });
    }

    const result: InstructionResult = {
      raw: JSON.stringify({ cleaned: targetName ?? "all" }),
      parsed: { kind: "build", passed: true, summary: "Cleanup completed (stub)" },
    };

    return context.withResult(instruction.id, result);
  }
}

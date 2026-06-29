import type { WorkspaceManager } from "../workspace";
import type { FlowContext } from "./FlowContext";
import type { CleanupInstruction, FlowInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a `cleanup` instruction by destroying the workspace that was
 * created by a prior workspace instruction.
 *
 * With named workspaces deferred (ADR 0005), this destroys the single
 * tracked workspace identified by `FlowContext.workspaceId`.
 */
export class CleanupStepExecutor extends StepExecutor<CleanupInstruction> {
  readonly type = "cleanup";

  constructor(private readonly workspaceManager: WorkspaceManager) {
    super();
  }

  override async execute(
    _instruction: CleanupInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    if (context.workspaceId) {
      try {
        await this.workspaceManager.destroy(context.workspaceId);
      } catch {
        // Workspace may already be destroyed — cleanup is best-effort.
      }
    }
    return context;
  }
}

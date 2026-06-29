import type { WorkspaceManager } from "../workspace";
import type { FlowContext } from "./FlowContext";
import type { FlowInstruction, WorkspaceInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a `workspace` instruction by creating an isolated workspace
 * via the {@link WorkspaceManager}.
 *
 * The workspace is registered under the instruction's `id` and both its
 * absolute path and id are stored in the flow context.
 */
export class WorkspaceStepExecutor extends StepExecutor<WorkspaceInstruction> {
  readonly type = "workspace";

  constructor(private readonly workspaceManager: WorkspaceManager) {
    super();
  }

  override async execute(
    instruction: WorkspaceInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const handle = await this.workspaceManager.create(instruction.id);
    return context.withWorkspace(handle.path, instruction.id);
  }
}

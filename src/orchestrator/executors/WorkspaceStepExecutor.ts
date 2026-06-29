import { logger } from "../../logging";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, WorkspaceInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "workspace" instruction by creating an isolated workspace
 * via the configured {@link WorkspaceProviderRegistry}.
 *
 * After creation the workspace handle is stored in {@link FlowContext.workspaces}
 * so downstream instructions can resolve its path via `{{workspace.<name>}}`.
 */
export class WorkspaceStepExecutor extends StepExecutor<WorkspaceInstruction> {
  readonly type = "workspace";

  constructor(private readonly providerRegistry: WorkspaceProviderRegistry) {
    super();
  }

  async execute(
    instruction: WorkspaceInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const providerName = instruction.provider;
    const workspaceId = instruction.id;

    const provider = this.providerRegistry.get(providerName);
    if (!provider) {
      throw new Error(
        `Unknown workspace provider "${providerName}" for instruction "${workspaceId}"`,
      );
    }

    logger.info("Creating workspace", { id: workspaceId, provider: providerName });
    const path = await provider.createWorkspace(workspaceId);
    const handle = new WorkspaceHandle(workspaceId, path, new Date());

    const result: InstructionResult = {
      raw: JSON.stringify({ path }),
      parsed: { kind: "build", passed: true, summary: `Workspace created at ${path}` },
    };

    return context.withWorkspace(workspaceId, handle).withResult(workspaceId, result);
  }
}

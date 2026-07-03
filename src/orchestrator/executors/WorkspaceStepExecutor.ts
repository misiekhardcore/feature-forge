import { logger } from "../../logging";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, WorkspaceInstruction } from "../FlowInstruction";
import type { RoutineProgress } from "../RoutineProgress";
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
    onProgress?: RoutineProgress,
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

    const updatedContext = context.withWorkspace(workspaceId, handle).withResult(workspaceId, {
      raw: JSON.stringify({ path }),
      parsed: { kind: "build", passed: true, summary: `Workspace created at ${path}` },
    });

    if (onProgress) {
      onProgress({
        phase: "workspace-ready",
        message: `Workspace "${workspaceId}" created at ${path}`,
        details: { workspace: path },
      });
    }

    return updatedContext;
  }
}

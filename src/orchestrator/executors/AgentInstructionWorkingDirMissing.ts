/**
 * Thrown when an agent instruction declares `workingDir: { workspace: <name> }`
 * but no workspace with the resolved name exists in the current
 * {@link import("../FlowContext").FlowContext}.
 *
 * The flow loader (`FlowLoader`) already rejects workspace references that are
 * not declared earlier in the same routine at load time, so this error guards
 * against the runtime-only case where a workspace was declared but never
 * materialised (e.g. its provider failed to allocate).
 */
export class AgentInstructionWorkingDirMissing extends Error {
  /** Instruction id that carried the unresolved `workingDir`. */
  public readonly instructionId: string;
  /** Workspace name that could not be resolved to a path. */
  public readonly workspaceName: string;

  constructor(instructionId: string, workspaceName: string) {
    super(
      `Agent instruction "${instructionId}" declares workingDir workspace ` +
        `"${workspaceName}", but no workspace with that name is available ` +
        `in the flow context`,
    );
    this.name = "AgentInstructionWorkingDirMissing";
    this.instructionId = instructionId;
    this.workspaceName = workspaceName;
  }
}

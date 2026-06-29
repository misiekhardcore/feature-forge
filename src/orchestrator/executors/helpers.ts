import type { FlowInstruction } from "../FlowInstruction";

/**
 * Access the `steps` array of a container instruction (parallel / loop).
 *
 * TypeBox 1.3.0's Type.Static can't see the runtime-patched `steps`
 * property on parallel/loop schemas. This helper casts through unknown
 * to avoid TS2339/TS2353 errors.
 */
export function containerSteps(instruction: FlowInstruction): FlowInstruction[] {
  return (instruction as unknown as { steps: FlowInstruction[] }).steps;
}

/**
 * Recursively collect all instruction ids from a list of instructions.
 *
 * Walks into parallel/loop containers. Used by LoopStepExecutor to
 * determine which result ids to clear between iterations.
 */
export function collectAllIds(
  instructions: FlowInstruction[],
  ids: Set<string> = new Set(),
): Set<string> {
  for (const instruction of instructions) {
    ids.add(instruction.id);
    if (instruction.type === "parallel" || instruction.type === "loop") {
      collectAllIds(containerSteps(instruction), ids);
    }
  }
  return ids;
}

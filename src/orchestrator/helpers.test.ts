import { describe, expect, it } from "vitest";

import type { FlowInstruction } from "./FlowInstruction";
import { collectAllIds, containerSteps } from "./helpers";

describe("containerSteps", () => {
  it("returns steps from a parallel instruction", () => {
    const child: FlowInstruction = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do",
    } as FlowInstruction;
    const instruction: FlowInstruction = {
      type: "parallel",
      id: "p1",
      steps: [child],
    } as unknown as FlowInstruction;

    expect(containerSteps(instruction)).toEqual([child]);
  });

  it("returns steps from a loop instruction", () => {
    const child: FlowInstruction = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do",
    } as FlowInstruction;
    const instruction: FlowInstruction = {
      type: "loop",
      id: "l1",
      maxIterations: 3,
      steps: [child],
    } as unknown as FlowInstruction;

    expect(containerSteps(instruction)).toEqual([child]);
  });
});

describe("collectAllIds", () => {
  it("collects ids from flat instructions", () => {
    const instructions: FlowInstruction[] = [
      { type: "agent", id: "a1", spec: "build", task: "do" } as FlowInstruction,
      { type: "agent", id: "a2", spec: "review", task: "review" } as FlowInstruction,
    ];

    const ids = collectAllIds(instructions);
    expect(ids).toEqual(new Set(["a1", "a2"]));
  });

  it("recursively collects ids from parallel containers", () => {
    const instructions: FlowInstruction[] = [
      {
        type: "parallel",
        id: "inspect",
        steps: [
          { type: "agent", id: "review", spec: "review", task: "do" } as FlowInstruction,
          { type: "agent", id: "verify", spec: "verify", task: "check" } as FlowInstruction,
        ],
      } as unknown as FlowInstruction,
    ];

    const ids = collectAllIds(instructions);
    expect(ids).toEqual(new Set(["inspect", "review", "verify"]));
  });

  it("recursively collects ids from nested containers", () => {
    const instructions: FlowInstruction[] = [
      {
        type: "loop",
        id: "build_loop",
        maxIterations: 3,
        steps: [
          { type: "agent", id: "builder", spec: "build", task: "do" } as FlowInstruction,
          {
            type: "parallel",
            id: "inspect",
            steps: [
              { type: "agent", id: "review", spec: "review", task: "review" } as FlowInstruction,
            ],
          } as unknown as FlowInstruction,
        ],
      } as unknown as FlowInstruction,
    ];

    const ids = collectAllIds(instructions);
    expect(ids).toEqual(new Set(["build_loop", "builder", "inspect", "review"]));
  });
});

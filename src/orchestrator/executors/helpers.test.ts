import { describe, expect, it } from "vitest";

import { makeParallelInstruction } from "../FlowInstruction";
import { collectAllIds, containerSteps } from "./helpers";

describe("helpers (executors)", () => {
  describe("containerSteps", () => {
    it("returns steps from a parallel instruction", () => {
      const steps = [{ type: "agent" as const, id: "a1", systemPrompt: "build", task: "do" }];
      const parallel = makeParallelInstruction("p1", steps);

      const result = containerSteps(parallel);
      expect(result).toBe(steps);
    });

    it("returns steps from a loop instruction", () => {
      const steps = [{ type: "agent" as const, id: "a1", systemPrompt: "build", task: "do" }];
      const loop = { type: "loop" as const, id: "l1", maxIterations: 3, steps };

      const result = containerSteps(loop);
      expect(result).toBe(steps);
    });
  });

  describe("collectAllIds", () => {
    it("collects ids from flat instructions", () => {
      const instructions = [
        { type: "agent" as const, id: "a1", systemPrompt: "b", task: "t" },
        { type: "agent" as const, id: "a2", systemPrompt: "b", task: "t" },
      ];

      const ids = collectAllIds(instructions);
      expect(ids.has("a1")).toBe(true);
      expect(ids.has("a2")).toBe(true);
    });

    it("recursively collects ids from nested containers", () => {
      const instructions = [
        { type: "agent" as const, id: "a1", systemPrompt: "b", task: "t" },
        {
          type: "parallel" as const,
          id: "p1",
          steps: [
            { type: "agent" as const, id: "a2", systemPrompt: "b", task: "t" },
            {
              type: "loop" as const,
              id: "l1",
              maxIterations: 3,
              steps: [{ type: "agent" as const, id: "a3", systemPrompt: "b", task: "t" }],
            },
          ],
        },
      ];

      const ids = collectAllIds(instructions);
      expect(ids.has("a1")).toBe(true);
      expect(ids.has("p1")).toBe(true);
      expect(ids.has("a2")).toBe(true);
      expect(ids.has("l1")).toBe(true);
      expect(ids.has("a3")).toBe(true);
    });
  });
});

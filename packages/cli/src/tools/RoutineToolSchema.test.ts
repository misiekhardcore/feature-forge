import type { FlowDefinition, RoutineDefinition, RoutineParam } from "@feature-forge/core/flows";
import { FLOW_SCHEMA_URL } from "@feature-forge/core/flows";
import { describe, expect, it } from "vitest";

import { RoutineToolSchema } from "./RoutineToolSchema";

// ── Helpers ──────────────────────────────────────────────────

/** Build a routine def embedded in the canonical test flow shape. */
function makeRoutine(params: RoutineParam[] = [], description?: string): RoutineDefinition {
  const flow: FlowDefinition = {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "t" },
    routines: [
      {
        id: "build",
        description,
        params,
        steps: [],
      },
    ],
  };
  return flow.routines[0];
}

// ── Tests ────────────────────────────────────────────────────

describe("buildDescription", () => {
  it("returns the default description when the routine has no params", () => {
    const routine = makeRoutine();
    expect(RoutineToolSchema.buildDescription(routine.id, routine)).toBe(
      'Run the "build" routine.',
    );
  });

  it("includes declared param names in the description", () => {
    const routine = makeRoutine([{ name: "task" }, { name: "plan" }]);
    expect(RoutineToolSchema.buildDescription(routine.id, routine)).toContain("task, plan");
  });

  it("renders param descriptions and optional flags in the param list", () => {
    const routine = makeRoutine([
      { name: "task", description: "the task", optional: true },
      { name: "plan" },
    ]);
    const description = RoutineToolSchema.buildDescription(routine.id, routine);
    expect(description).toContain("task (the task) [optional]");
    expect(description).toContain("plan");
  });

  it("uses a custom routine description as the base when params exist", () => {
    const routine = makeRoutine([{ name: "task" }], "Run the routine");
    expect(RoutineToolSchema.buildDescription(routine.id, routine)).toBe("Run the routine: task.");
  });

  it("returns a custom routine description verbatim when there are no params", () => {
    const routine = makeRoutine([], "Custom routine description");
    expect(RoutineToolSchema.buildDescription(routine.id, routine)).toBe(
      "Custom routine description",
    );
  });
});

describe("buildParamsSchema", () => {
  it("lists required params in the schema required array", () => {
    const routine = makeRoutine([{ name: "workspace" }, { name: "title" }]);
    const parsed = JSON.parse(JSON.stringify(RoutineToolSchema.buildParamsSchema(routine)));
    expect(parsed.required).toContain("workspace");
    expect(parsed.required).toContain("title");
  });

  it("omits the required array when all params are optional", () => {
    const routine = makeRoutine([
      { name: "branch", optional: true },
      { name: "baseRef", optional: true },
    ]);
    const parsed = JSON.parse(JSON.stringify(RoutineToolSchema.buildParamsSchema(routine)));
    expect(parsed.required).toBeUndefined();
  });

  it("excludes optional params from the required array", () => {
    const routine = makeRoutine([{ name: "task" }, { name: "plan", optional: true }]);
    const parsed = JSON.parse(JSON.stringify(RoutineToolSchema.buildParamsSchema(routine)));
    expect(parsed.required).toEqual(["task"]);
  });

  it("propagates param descriptions into the schema property descriptions", () => {
    const routine = makeRoutine([{ name: "task", description: "what to do" }]);
    const parsed = JSON.parse(JSON.stringify(RoutineToolSchema.buildParamsSchema(routine)));
    expect(parsed.properties.task.description).toBe("what to do");
  });
});

import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  FlowDefinitionSchema,
  FlowInstructionSchema,
  LoopInstructionSchema,
  ParallelInstructionSchema,
  RoutineSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "./FlowInstruction";

// ---------------------------------------------------------------------------
// Individual instruction schemas
// ---------------------------------------------------------------------------

describe("WorkspaceInstructionSchema", () => {
  it("validates a minimal workspace instruction", () => {
    const valid = { type: "workspace", id: "ws1" };
    expect(Value.Check(WorkspaceInstructionSchema, valid)).toBe(true);
  });

  it("rejects wrong type", () => {
    const invalid = { type: "agent", id: "ws1" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty id", () => {
    const invalid = { type: "workspace", id: "" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });
});

describe("AgentInstructionSchema", () => {
  it("validates a minimal agent instruction", () => {
    const valid = { type: "agent", id: "a1", spec: "build", task: "do it" };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("validates with optional fields", () => {
    const valid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      workingDir: "/tmp/ws",
      parseJson: true,
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("accepts workingDir: 'workspace' literal", () => {
    const valid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      workingDir: "workspace",
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("accepts workingDir as a custom path", () => {
    const valid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      workingDir: "/tmp/custom-path",
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("rejects empty workingDir string", () => {
    const invalid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      workingDir: "",
    };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing spec", () => {
    const invalid = { type: "agent", id: "a1", task: "do it" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing task", () => {
    const invalid = { type: "agent", id: "a1", spec: "build" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty spec", () => {
    const invalid = { type: "agent", id: "a1", spec: "", task: "do it" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("accepts optional specInput with string values", () => {
    const valid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      specInput: {
        TASK: "{{task}}",
        WORKSPACE: "{{workspace}}",
      },
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("accepts empty specInput object", () => {
    const valid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      specInput: {},
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("rejects specInput with non-string value", () => {
    const invalid = {
      type: "agent",
      id: "a1",
      spec: "build",
      task: "do it",
      specInput: { TASK: 123 },
    };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });
});

describe("ParallelInstructionSchema", () => {
  it("validates a parallel instruction with nested steps", () => {
    const valid = {
      type: "parallel",
      id: "p1",
      steps: [
        { type: "agent", id: "a1", spec: "build", task: "do it" },
        { type: "agent", id: "a2", spec: "review", task: "review", parseJson: true },
      ],
    };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });

  it("validates with empty steps array", () => {
    const valid = { type: "parallel", id: "p1", steps: [] };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });
});

describe("LoopInstructionSchema", () => {
  it("validates a full loop instruction", () => {
    const valid = {
      type: "loop",
      id: "l1",
      maxIterations: 5,
      continueWhile: "!steps.review?.parsed?.passed",
      accumulateFrom: ["review", "verify"],
      steps: [{ type: "agent", id: "a1", spec: "build", task: "do it" }],
    };
    expect(Value.Check(LoopInstructionSchema, valid)).toBe(true);
  });

  it("validates a loop without optional fields", () => {
    const valid = {
      type: "loop",
      id: "l1",
      maxIterations: 3,
      steps: [],
    };
    expect(Value.Check(LoopInstructionSchema, valid)).toBe(true);
  });

  it("rejects maxIterations of 0", () => {
    const invalid = { type: "loop", id: "l1", maxIterations: 0, steps: [] };
    expect(Value.Check(LoopInstructionSchema, invalid)).toBe(false);
  });

  it("rejects negative maxIterations", () => {
    const invalid = { type: "loop", id: "l1", maxIterations: -1, steps: [] };
    expect(Value.Check(LoopInstructionSchema, invalid)).toBe(false);
  });

  it("rejects non-integer maxIterations", () => {
    const invalid = { type: "loop", id: "l1", maxIterations: 2.5, steps: [] };
    expect(Value.Check(LoopInstructionSchema, invalid)).toBe(false);
  });
});

describe("CleanupInstructionSchema", () => {
  it("validates a minimal cleanup instruction", () => {
    const valid = { type: "cleanup", id: "c1" };
    expect(Value.Check(CleanupInstructionSchema, valid)).toBe(true);
  });
});

describe("ShellInstructionSchema", () => {
  it("validates a minimal shell instruction", () => {
    const valid = { type: "shell", id: "s1", command: "echo hello" };
    expect(Value.Check(ShellInstructionSchema, valid)).toBe(true);
  });

  it("validates with optional cwd", () => {
    const valid = { type: "shell", id: "s1", command: "echo hello", cwd: "/tmp" };
    expect(Value.Check(ShellInstructionSchema, valid)).toBe(true);
  });

  it("rejects missing command", () => {
    const invalid = { type: "shell", id: "s1" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty command", () => {
    const invalid = { type: "shell", id: "s1", command: "" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });

  it("rejects wrong type", () => {
    const invalid = { type: "agent", id: "s1", command: "echo hello" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FlowInstructionSchema (union)
// ---------------------------------------------------------------------------

describe("FlowInstructionSchema", () => {
  it("matches workspace type", () => {
    expect(Value.Check(FlowInstructionSchema, { type: "workspace", id: "ws1" })).toBe(true);
  });

  it("matches agent type", () => {
    expect(
      Value.Check(FlowInstructionSchema, {
        type: "agent",
        id: "a1",
        spec: "build",
        task: "do it",
      }),
    ).toBe(true);
  });

  it("matches parallel type", () => {
    expect(Value.Check(FlowInstructionSchema, { type: "parallel", id: "p1", steps: [] })).toBe(
      true,
    );
  });

  it("matches loop type", () => {
    expect(
      Value.Check(FlowInstructionSchema, { type: "loop", id: "l1", maxIterations: 3, steps: [] }),
    ).toBe(true);
  });

  it("matches cleanup type", () => {
    expect(Value.Check(FlowInstructionSchema, { type: "cleanup", id: "c1" })).toBe(true);
  });

  it("matches shell type", () => {
    expect(
      Value.Check(FlowInstructionSchema, { type: "shell", id: "s1", command: "echo hello" }),
    ).toBe(true);
  });

  it("rejects unknown type", () => {
    expect(Value.Check(FlowInstructionSchema, { type: "unknown", id: "x" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RoutineSchema
// ---------------------------------------------------------------------------

describe("RoutineSchema", () => {
  it("validates a routine with params and steps", () => {
    const valid = {
      params: [{ name: "task", description: "The task" }],
      steps: [{ type: "workspace", id: "ws" }],
    };
    expect(Value.Check(RoutineSchema, valid)).toBe(true);
  });

  it("validates a routine with empty params", () => {
    const valid = {
      params: [],
      steps: [{ type: "cleanup", id: "c1" }],
    };
    expect(Value.Check(RoutineSchema, valid)).toBe(true);
  });

  it("validates a routine without param descriptions", () => {
    const valid = {
      params: [{ name: "workspace" }],
      steps: [{ type: "workspace", id: "ws" }],
    };
    expect(Value.Check(RoutineSchema, valid)).toBe(true);
  });

  it("rejects routine with empty param name", () => {
    const invalid = {
      params: [{ name: "" }],
      steps: [{ type: "workspace", id: "ws" }],
    };
    expect(Value.Check(RoutineSchema, invalid)).toBe(false);
  });

  it("rejects routine with missing params", () => {
    const invalid = {
      steps: [{ type: "workspace", id: "ws" }],
    };
    expect(Value.Check(RoutineSchema, invalid)).toBe(false);
  });

  it("rejects routine with invalid step type", () => {
    const invalid = {
      params: [],
      steps: [{ type: "unknown", id: "x" }],
    };
    expect(Value.Check(RoutineSchema, invalid)).toBe(false);
  });

  it("rejects routine with nested invalid instruction", () => {
    const invalid = {
      params: [],
      steps: [
        {
          type: "loop",
          id: "l1",
          maxIterations: 3,
          steps: [{ type: "agent", id: "a1" }], // missing spec and task
        },
      ],
    };
    expect(Value.Check(RoutineSchema, invalid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FlowDefinitionSchema
// ---------------------------------------------------------------------------

describe("FlowDefinitionSchema", () => {
  const validFlow = {
    name: "implement",
    command: "/implement",
    orchestrator: { prompt: "orchestrator.md" },
    routines: {
      run_build_loop: {
        params: [
          { name: "task", description: "The task description" },
          { name: "plan", description: "The implementation plan" },
        ],
        steps: [
          { type: "workspace" as const, id: "ws" },
          {
            type: "loop" as const,
            id: "build_loop",
            maxIterations: 5,
            continueWhile:
              "!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed",
            accumulateFrom: ["review", "verify"],
            steps: [
              {
                type: "agent" as const,
                id: "builder",
                spec: "build",
                task: "Build: {{task}}",
                workingDir: "workspace",
                parseJson: true,
              },
              {
                type: "parallel" as const,
                id: "inspect",
                steps: [
                  {
                    type: "agent" as const,
                    id: "review",
                    spec: "review",
                    task: "Review",
                    workingDir: "workspace",
                    parseJson: true,
                  },
                  {
                    type: "agent" as const,
                    id: "verify",
                    spec: "verify",
                    task: "Verify",
                    workingDir: "workspace",
                    parseJson: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      destroy_workspace: {
        params: [{ name: "workspace" }],
        steps: [{ type: "cleanup" as const, id: "destroy_cleanup" }],
      },
    },
  };

  it("validates a complete implement flow with routines", () => {
    expect(Value.Check(FlowDefinitionSchema, validFlow)).toBe(true);
  });

  it("rejects missing name", () => {
    const { name: _, ...rest } = validFlow;
    expect(Value.Check(FlowDefinitionSchema, rest)).toBe(false);
  });

  it("rejects empty name", () => {
    expect(Value.Check(FlowDefinitionSchema, { ...validFlow, name: "" })).toBe(false);
  });

  it("rejects missing command", () => {
    const { command: _, ...rest } = validFlow;
    expect(Value.Check(FlowDefinitionSchema, rest)).toBe(false);
  });

  it("rejects missing orchestrator", () => {
    const { orchestrator: _, ...rest } = validFlow;
    expect(Value.Check(FlowDefinitionSchema, rest)).toBe(false);
  });

  it("accepts orchestrator with only prompt", () => {
    const flow = {
      ...validFlow,
      orchestrator: { prompt: "o.md" },
    };
    expect(Value.Check(FlowDefinitionSchema, flow)).toBe(true);
  });

  it("accepts orchestrator with prompt and activeTools", () => {
    const flow = {
      ...validFlow,
      orchestrator: { prompt: "o.md", activeTools: ["run_build_loop", "destroy_workspace"] },
    };
    expect(Value.Check(FlowDefinitionSchema, flow)).toBe(true);
  });

  it("rejects missing orchestrator.prompt", () => {
    expect(
      Value.Check(FlowDefinitionSchema, {
        ...validFlow,
        orchestrator: { prompt: "" },
      }),
    ).toBe(false);
  });

  it("rejects empty activeTools entry", () => {
    expect(
      Value.Check(FlowDefinitionSchema, {
        ...validFlow,
        orchestrator: { prompt: "o.md", activeTools: [""] },
      }),
    ).toBe(false);
  });

  it("rejects missing routines", () => {
    const { routines: _, ...rest } = validFlow;
    expect(Value.Check(FlowDefinitionSchema, rest)).toBe(false);
  });

  it("accepts routines with empty key at structural level (semantic check handles it)", () => {
    // patternProperties ^.*$ matches empty keys too — structural validation
    // won't reject this. Real flows never have empty keys, and semantic
    // validation would catch the routine with no meaningful name.
    expect(
      Value.Check(FlowDefinitionSchema, {
        ...validFlow,
        routines: {
          "": { params: [], steps: [] },
        },
      }),
    ).toBe(true);
  });

  it("rejects a step with unknown type", () => {
    const invalid = {
      ...validFlow,
      routines: {
        r: { params: [], steps: [{ type: "unknown", id: "x" }] },
      },
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
  });

  it("rejects a step missing required fields", () => {
    const invalid = {
      ...validFlow,
      routines: {
        r: { params: [], steps: [{ type: "agent", id: "a1" }] },
      },
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
  });

  it("rejects a nested instruction missing required fields (recursive validation)", () => {
    const invalid = {
      name: "test",
      command: "/test",
      orchestrator: { prompt: "o.md" },
      routines: {
        r: {
          params: [],
          steps: [
            {
              type: "loop",
              id: "l1",
              maxIterations: 3,
              steps: [
                { type: "agent", id: "b" }, // missing spec and task
              ],
            },
          ],
        },
      },
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
    const errors = [...Value.Errors(FlowDefinitionSchema, invalid)];
    const messages = errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("spec") || m.includes("task"))).toBe(true);
  });

  it("rejects deeply nested invalid instruction type", () => {
    const invalid = {
      name: "test",
      command: "/test",
      orchestrator: { prompt: "o.md" },
      routines: {
        r: {
          params: [],
          steps: [
            {
              type: "loop",
              id: "l1",
              maxIterations: 3,
              steps: [
                {
                  type: "parallel",
                  id: "p1",
                  steps: [
                    { type: "unknown_type", id: "x" }, // invalid
                  ],
                },
              ],
            },
          ],
        },
      },
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
  });

  it("produces human-readable errors for invalid flows", () => {
    const invalid = {
      name: "test",
      command: "/test",
      orchestrator: { prompt: "o.md" },
      routines: {
        r: {
          params: [],
          steps: [{ type: "agent", id: "a1" }],
        },
      },
    };
    const errors = [...Value.Errors(FlowDefinitionSchema, invalid)];
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("spec") || m.includes("task"))).toBe(true);
  });
});

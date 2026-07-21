import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  FLOW_SCHEMA_URL,
  FlowDefinitionSchema,
  FlowInstructionSchema,
  GitInstructionSchema,
  isContainerInstruction,
  isLoopInstruction,
  isParallelInstruction,
  isRoutineRefInstruction,
  LoopInstructionSchema,
  makeLoopInstruction,
  makeParallelInstruction,
  OrchestratorConfigSchema,
  ParallelInstructionSchema,
  RoutineParamSchema,
  RoutineRefInstructionSchema,
  SessionInstructionSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "./FlowInstruction";
import { FlowLoader } from "./FlowLoader";

// ---------------------------------------------------------------------------
// Individual instruction schemas
// ---------------------------------------------------------------------------

describe("WorkspaceInstructionSchema", () => {
  it("validates a minimal workspace instruction with provider", () => {
    const valid = { type: "workspace", id: "ws1", provider: "git-worktree" };
    expect(Value.Check(WorkspaceInstructionSchema, valid)).toBe(true);
  });

  it("accepts current-dir provider", () => {
    const valid = { type: "workspace", id: "ws1", provider: "current-dir" };
    expect(Value.Check(WorkspaceInstructionSchema, valid)).toBe(true);
  });

  it("rejects missing provider", () => {
    const invalid = { type: "workspace", id: "ws1" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });

  it("rejects wrong type", () => {
    const invalid = { type: "agent", id: "ws1", provider: "git-worktree" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty id", () => {
    const invalid = { type: "workspace", id: "", provider: "git-worktree" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });

  it("rejects unknown provider", () => {
    const invalid = { type: "workspace", id: "ws1", provider: "docker" };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });

  it("validates a workspace with baseRef", () => {
    const valid = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
      baseRef: "origin/HEAD",
    };
    expect(Value.Check(WorkspaceInstructionSchema, valid)).toBe(true);
  });

  it("rejects empty baseRef", () => {
    const invalid = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
      baseRef: "",
    };
    expect(Value.Check(WorkspaceInstructionSchema, invalid)).toBe(false);
  });
});

describe("AgentInstructionSchema", () => {
  it("validates a minimal agent instruction", () => {
    const valid = { type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("validates with optional fields", () => {
    const valid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      parseJson: true,
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("accepts workingDir as workspace reference object", () => {
    const valid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      workingDir: { workspace: "ws" },
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("accepts workingDir as path object", () => {
    const valid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      workingDir: { path: "/tmp/custom-path" },
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("rejects workingDir with empty workspace name", () => {
    const invalid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      workingDir: { workspace: "" },
    };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects workingDir with empty path", () => {
    const invalid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      workingDir: { path: "" },
    };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects workingDir with unknown shape", () => {
    const invalid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      workingDir: { foo: "bar" },
    };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("accepts promptParams record", () => {
    const valid = {
      type: "agent",
      id: "a1",
      systemPrompt: "build",
      prompt: "do it",
      promptParams: { prompt: "{{prompt}}", PLAN: "{{plan}}" },
    };
    expect(Value.Check(AgentInstructionSchema, valid)).toBe(true);
  });

  it("rejects missing systemPrompt", () => {
    const invalid = { type: "agent", id: "a1", prompt: "do it" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing task", () => {
    const invalid = { type: "agent", id: "a1", systemPrompt: "build" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty systemPrompt", () => {
    const invalid = { type: "agent", id: "a1", systemPrompt: "", prompt: "do it" };
    expect(Value.Check(AgentInstructionSchema, invalid)).toBe(false);
  });
});

describe("ParallelInstructionSchema", () => {
  it("validates a parallel instruction with nested steps", () => {
    const valid = {
      type: "parallel",
      id: "p1",
      steps: [
        { type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" },
        { type: "agent", id: "a2", systemPrompt: "review", prompt: "review", parseJson: true },
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
      continueWhile: "!results.review?.parsed?.passed",
      accumulateFrom: ["review", "verify"],
      steps: [{ type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" }],
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

  it("validates a cleanup instruction with of field", () => {
    const valid = { type: "cleanup", id: "c1", of: "ws" };
    expect(Value.Check(CleanupInstructionSchema, valid)).toBe(true);
  });

  it("rejects empty of", () => {
    const invalid = { type: "cleanup", id: "c1", of: "" };
    expect(Value.Check(CleanupInstructionSchema, invalid)).toBe(false);
  });
});

describe("GitInstructionSchema", () => {
  it("validates add-and-commit action", () => {
    const valid = { type: "git", id: "g1", action: "add-and-commit", cwd: "/tmp/ws" };
    expect(Value.Check(GitInstructionSchema, valid)).toBe(true);
  });

  it("validates push-current action", () => {
    const valid = { type: "git", id: "g1", action: "push-current", cwd: "/tmp/ws" };
    expect(Value.Check(GitInstructionSchema, valid)).toBe(true);
  });

  it("rejects unknown action", () => {
    const invalid = { type: "git", id: "g1", action: "rebase", cwd: "/tmp/ws" };
    expect(Value.Check(GitInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing action", () => {
    const invalid = { type: "git", id: "g1", cwd: "/tmp/ws" };
    expect(Value.Check(GitInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing cwd", () => {
    const invalid = { type: "git", id: "g1", action: "add-and-commit" };
    expect(Value.Check(GitInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty cwd", () => {
    const invalid = { type: "git", id: "g1", action: "add-and-commit", cwd: "" };
    expect(Value.Check(GitInstructionSchema, invalid)).toBe(false);
  });
});

describe("SessionInstructionSchema", () => {
  it("validates a session instruction", () => {
    const valid = { type: "session", id: "s1", key: "base", value: "/tmp/ws" };
    expect(Value.Check(SessionInstructionSchema, valid)).toBe(true);
  });

  it("rejects missing key", () => {
    const invalid = { type: "session", id: "s1", value: "/tmp/ws" };
    expect(Value.Check(SessionInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty key", () => {
    const invalid = { type: "session", id: "s1", key: "", value: "/tmp/ws" };
    expect(Value.Check(SessionInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing value", () => {
    const invalid = { type: "session", id: "s1", key: "base" };
    expect(Value.Check(SessionInstructionSchema, invalid)).toBe(false);
  });
});

describe("ShellInstructionSchema", () => {
  it("validates a shell instruction", () => {
    const valid = { type: "shell", id: "s1", command: "echo hello", cwd: "/tmp/ws" };
    expect(Value.Check(ShellInstructionSchema, valid)).toBe(true);
  });

  it("rejects missing command", () => {
    const invalid = { type: "shell", id: "s1", cwd: "/tmp/ws" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty command", () => {
    const invalid = { type: "shell", id: "s1", command: "", cwd: "/tmp/ws" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });

  it("rejects missing cwd", () => {
    const invalid = { type: "shell", id: "s1", command: "echo hello" };
    expect(Value.Check(ShellInstructionSchema, invalid)).toBe(false);
  });

  it("validates a shell instruction with failFast", () => {
    const valid = {
      type: "shell",
      id: "s1",
      command: "echo hello",
      cwd: "/tmp/ws",
      failFast: true,
    };
    expect(Value.Check(ShellInstructionSchema, valid)).toBe(true);
  });

  it("accepts shell instruction without failFast (optional)", () => {
    const valid = { type: "shell", id: "s1", command: "echo hello", cwd: "/tmp/ws" };
    expect(Value.Check(ShellInstructionSchema, valid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FlowInstructionSchema (union)
// ---------------------------------------------------------------------------

describe("FlowInstructionSchema", () => {
  it("matches workspace type", () => {
    expect(
      Value.Check(FlowInstructionSchema, {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      }),
    ).toBe(true);
  });

  it("matches agent type", () => {
    expect(
      Value.Check(FlowInstructionSchema, {
        type: "agent",
        id: "a1",
        systemPrompt: "build",
        prompt: "do it",
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

  it("matches git type", () => {
    expect(
      Value.Check(FlowInstructionSchema, {
        type: "git",
        id: "g1",
        action: "add-and-commit",
        cwd: "/ws",
      }),
    ).toBe(true);
  });

  it("matches shell type", () => {
    expect(
      Value.Check(FlowInstructionSchema, {
        type: "shell",
        id: "s1",
        command: "ls",
        cwd: "/ws",
      }),
    ).toBe(true);
  });

  it("rejects unknown type", () => {
    expect(Value.Check(FlowInstructionSchema, { type: "unknown", id: "x" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorConfigSchema
// ---------------------------------------------------------------------------

describe("OrchestratorConfigSchema", () => {
  it("validates minimal config with systemPrompt", () => {
    const valid = { systemPrompt: "You are the orchestrator." };
    expect(Value.Check(OrchestratorConfigSchema, valid)).toBe(true);
  });

  it("validates with task and promptParams", () => {
    const valid = {
      systemPrompt: "You are the orchestrator.",
      prompt: "{{prompt}}",
      promptParams: { prompt: "{{prompt}}" },
    };
    expect(Value.Check(OrchestratorConfigSchema, valid)).toBe(true);
  });

  it("rejects empty systemPrompt", () => {
    const invalid = { systemPrompt: "" };
    expect(Value.Check(OrchestratorConfigSchema, invalid)).toBe(false);
  });

  it("rejects missing systemPrompt", () => {
    const invalid = { prompt: "x" };
    expect(Value.Check(OrchestratorConfigSchema, invalid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RoutineParamSchema
// ---------------------------------------------------------------------------

describe("RoutineParamSchema", () => {
  it("validates minimal param with name", () => {
    const valid = { name: "task" };
    expect(Value.Check(RoutineParamSchema, valid)).toBe(true);
  });

  it("validates param with description", () => {
    const valid = { name: "task", description: "The task description" };
    expect(Value.Check(RoutineParamSchema, valid)).toBe(true);
  });

  it("rejects empty name", () => {
    const invalid = { name: "" };
    expect(Value.Check(RoutineParamSchema, invalid)).toBe(false);
  });

  it("rejects missing name", () => {
    const invalid = { description: "desc" };
    expect(Value.Check(RoutineParamSchema, invalid)).toBe(false);
  });

  it("rejects empty string description (allowed)", () => {
    // description is Optional(string), no minLength constraint
    const valid = { name: "task", description: "" };
    expect(Value.Check(RoutineParamSchema, valid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FlowDefinitionSchema
// ---------------------------------------------------------------------------

describe("FlowDefinitionSchema", () => {
  const validFlow = {
    $schema: FLOW_SCHEMA_URL,
    name: "implement",
    command: "/implement",
    orchestrator: {
      systemPrompt: "You are the orchestrator.",
    },
    routines: [
      {
        id: "run_build_loop",
        params: [
          { name: "task", description: "The task description" },
          { name: "plan", description: "The implementation plan" },
        ],
        steps: [
          {
            type: "workspace" as const,
            id: "ws",
            provider: "git-worktree" as const,
            baseRef: "origin/HEAD",
          },
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
                systemPrompt: "build",
                prompt: "Build: {{prompt}}",
                workingDir: { workspace: "ws" },
                parseJson: true,
                promptParams: { prompt: "{{prompt}}", PLAN: "{{plan}}" },
              },
              {
                type: "parallel" as const,
                id: "inspect",
                steps: [
                  {
                    type: "agent" as const,
                    id: "review",
                    systemPrompt: "review",
                    prompt: "Review",
                    workingDir: { workspace: "ws" },
                    parseJson: true,
                  },
                  {
                    type: "agent" as const,
                    id: "verify",
                    systemPrompt: "verify",
                    prompt: "Verify",
                    workingDir: { workspace: "ws" },
                    parseJson: true,
                  },
                ],
              },
            ],
          },
          { type: "cleanup" as const, id: "cleanup", of: "ws" },
        ],
      },
      {
        id: "open_pr",
        params: [
          { name: "workspace" },
          { name: "title" },
          { name: "commit_message" },
          { name: "body" },
        ],
        steps: [
          {
            type: "git" as const,
            id: "commit",
            action: "add-and-commit" as const,
            cwd: "{{workspace}}",
            message: "{{commit_message}}",
          },
          {
            type: "shell" as const,
            id: "fetch",
            command: "git fetch origin {{session.base}}",
            cwd: "{{workspace}}",
            failFast: true,
          },
          {
            type: "shell" as const,
            id: "rebase",
            command: "git rebase origin/{{session.base}}",
            cwd: "{{workspace}}",
            failFast: true,
          },
          {
            type: "shell" as const,
            id: "revalidate",
            command: "npm run fix && npm run lint && npm run typecheck && npm run test",
            cwd: "{{workspace}}",
            failFast: true,
          },
          {
            type: "git" as const,
            id: "branch",
            action: "push-current" as const,
            cwd: "{{workspace}}",
          },
          {
            type: "shell" as const,
            id: "pr",
            command: 'gh pr create --title "{{title}}" --body "{{body}}" --base "{{session.base}}"',
            cwd: "{{workspace}}",
          },
        ],
      },
    ],
  };

  it("validates a complete implement flow", () => {
    expect(Value.Check(FlowDefinitionSchema, validFlow)).toBe(true);
  });

  it("validates with orchestrator having only systemPrompt", () => {
    const flow = {
      ...validFlow,
      orchestrator: { systemPrompt: "You are the orchestrator." },
    };
    expect(Value.Check(FlowDefinitionSchema, flow)).toBe(true);
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

  it("rejects orchestrator with empty systemPrompt", () => {
    expect(
      Value.Check(FlowDefinitionSchema, {
        ...validFlow,
        orchestrator: { systemPrompt: "" },
      }),
    ).toBe(false);
  });

  it("rejects missing routines", () => {
    const { routines: _, ...rest } = validFlow;
    expect(Value.Check(FlowDefinitionSchema, rest)).toBe(false);
  });

  it("accepts empty routines array", () => {
    expect(Value.Check(FlowDefinitionSchema, { ...validFlow, routines: [] })).toBe(true);
  });

  it("rejects a routine with missing params", () => {
    const invalid = {
      ...validFlow,
      routines: [
        {
          id: "main",
          steps: [{ type: "cleanup", id: "c" }],
        },
      ],
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
  });

  it("rejects a routine with missing steps", () => {
    const invalid = {
      ...validFlow,
      routines: [
        {
          id: "main",
          params: [{ name: "task" }],
        },
      ],
    };
    expect(Value.Check(FlowDefinitionSchema, invalid)).toBe(false);
  });

  it("rejects a step with unknown type", () => {
    const invalid = {
      ...validFlow,
      routines: [
        {
          id: "main",
          params: [],
          steps: [{ type: "unknown", id: "x" }],
        },
      ],
    };
    expect(() => FlowLoader.validateStructure(invalid)).toThrow();
  });

  it("rejects a nested instruction missing required fields (recursive validation)", () => {
    const invalid = {
      $schema: FLOW_SCHEMA_URL,
      name: "test",
      command: "/test",
      orchestrator: { systemPrompt: "t" },
      routines: [
        {
          id: "main",
          params: [],
          steps: [
            {
              type: "loop",
              id: "l1",
              maxIterations: 3,
              steps: [
                { type: "agent", id: "b" }, // missing systemPrompt and task
              ],
            },
          ],
        },
      ],
    };
    expect(() => FlowLoader.validateStructure(invalid)).toThrow("Invalid flow definition");
  });

  it("rejects deeply nested invalid instruction type", () => {
    const invalid = {
      $schema: FLOW_SCHEMA_URL,
      name: "test",
      command: "/test",
      orchestrator: { systemPrompt: "t" },
      routines: [
        {
          id: "main",
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
      ],
    };
    expect(() => FlowLoader.validateStructure(invalid)).toThrow("Invalid flow definition");
  });

  it("produces human-readable errors for invalid flows", () => {
    const invalid = {
      $schema: FLOW_SCHEMA_URL,
      name: "test",
      command: "/test",
      orchestrator: { systemPrompt: "t" },
      routines: [
        {
          id: "main",
          params: [],
          steps: [{ type: "agent", id: "a1" }],
        },
      ],
    };
    expect(() => FlowLoader.validateStructure(invalid)).toThrow("Invalid flow definition");
  });

  it("accepts a flow with the correct $schema value", () => {
    expect(
      Value.Check(FlowDefinitionSchema, {
        $schema: FLOW_SCHEMA_URL,
        name: "test",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "main", params: [], steps: [] }],
      }),
    ).toBe(true);
  });

  it("rejects a flow with an incorrect $schema value", () => {
    expect(
      Value.Check(FlowDefinitionSchema, {
        $schema: "https://example.com/wrong-schema.json",
        name: "test",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: [{ id: "main", params: [], steps: [] }],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("isParallelInstruction", () => {
  it("returns true for parallel instructions", () => {
    expect(isParallelInstruction({ type: "parallel", id: "p1", steps: [] })).toBe(true);
  });

  it("returns false for loop instructions", () => {
    expect(isParallelInstruction({ type: "loop", id: "l1", maxIterations: 3, steps: [] })).toBe(
      false,
    );
  });

  it("returns false for agent instructions", () => {
    expect(
      isParallelInstruction({ type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" }),
    ).toBe(false);
  });
});

describe("isLoopInstruction", () => {
  it("returns true for loop instructions", () => {
    expect(isLoopInstruction({ type: "loop", id: "l1", maxIterations: 3, steps: [] })).toBe(true);
  });

  it("returns false for parallel instructions", () => {
    expect(isLoopInstruction({ type: "parallel", id: "p1", steps: [] })).toBe(false);
  });

  it("returns false for agent instructions", () => {
    expect(
      isLoopInstruction({ type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" }),
    ).toBe(false);
  });
});

describe("isContainerInstruction", () => {
  it("returns true for parallel instructions", () => {
    expect(isContainerInstruction({ type: "parallel", id: "p1", steps: [] })).toBe(true);
  });

  it("returns true for loop instructions", () => {
    expect(isContainerInstruction({ type: "loop", id: "l1", maxIterations: 3, steps: [] })).toBe(
      true,
    );
  });

  it("returns false for agent instructions", () => {
    expect(
      isContainerInstruction({ type: "agent", id: "a1", systemPrompt: "build", prompt: "do it" }),
    ).toBe(false);
  });

  it("returns false for workspace instructions", () => {
    expect(isContainerInstruction({ type: "workspace", id: "ws1", provider: "git-worktree" })).toBe(
      false,
    );
  });

  it("returns false for cleanup instructions", () => {
    expect(isContainerInstruction({ type: "cleanup", id: "c1" })).toBe(false);
  });

  it("returns false for git instructions", () => {
    expect(
      isContainerInstruction({
        type: "git",
        id: "g1",
        action: "add-and-commit",
        cwd: "/ws",
      }),
    ).toBe(false);
  });

  it("returns false for shell instructions", () => {
    expect(isContainerInstruction({ type: "shell", id: "s1", command: "ls", cwd: "/ws" })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

describe("makeParallelInstruction", () => {
  it("creates a parallel instruction with steps", () => {
    const steps = [{ type: "agent" as const, id: "a1", systemPrompt: "build", prompt: "do it" }];
    const instr = makeParallelInstruction("p1", steps);
    expect(instr.type).toBe("parallel");
    expect(instr.id).toBe("p1");
    expect(instr.steps).toBe(steps);
  });

  it("creates a parallel instruction with empty steps", () => {
    const instr = makeParallelInstruction("p1", []);
    expect(instr.type).toBe("parallel");
    expect(instr.steps).toEqual([]);
  });
});

describe("makeLoopInstruction", () => {
  it("creates a minimal loop instruction", () => {
    const steps = [{ type: "agent" as const, id: "a1", systemPrompt: "build", prompt: "do it" }];
    const instr = makeLoopInstruction("l1", 3, steps);
    expect(instr.type).toBe("loop");
    expect(instr.id).toBe("l1");
    expect(instr.maxIterations).toBe(3);
    expect(instr.steps).toBe(steps);
    expect(instr.continueWhile).toBeUndefined();
    expect(instr.accumulateFrom).toBeUndefined();
  });

  it("creates a loop instruction with continueWhile", () => {
    const instr = makeLoopInstruction("l1", 3, [], "!results.r?.parsed?.passed");
    expect(instr.continueWhile).toBe("!results.r?.parsed?.passed");
  });

  it("creates a loop instruction with accumulateFrom", () => {
    const instr = makeLoopInstruction("l1", 3, [], undefined, ["review", "verify"]);
    expect(instr.accumulateFrom).toEqual(["review", "verify"]);
  });

  it("creates a full loop instruction", () => {
    const instr = makeLoopInstruction(
      "l1",
      5,
      [{ type: "agent" as const, id: "a1", systemPrompt: "build", prompt: "do it" }],
      "!results.r?.parsed?.passed",
      ["review"],
    );
    expect(instr.type).toBe("loop");
    expect(instr.id).toBe("l1");
    expect(instr.maxIterations).toBe(5);
    expect(instr.steps).toHaveLength(1);
    expect(instr.continueWhile).toBe("!results.r?.parsed?.passed");
    expect(instr.accumulateFrom).toEqual(["review"]);
  });
});

describe("RoutineRefInstructionSchema", () => {
  it("validates a minimal routine ref instruction", () => {
    const result = Value.Check(RoutineRefInstructionSchema, {
      type: "routine",
      id: "call-review",
      target: "review",
    });
    expect(result).toBe(true);
  });

  it("validates a routine ref with output_as", () => {
    const result = Value.Check(RoutineRefInstructionSchema, {
      type: "routine",
      id: "call-review",
      target: "review",
      output_as: "review_result",
    });
    expect(result).toBe(true);
  });

  it("rejects missing target", () => {
    const result = Value.Check(RoutineRefInstructionSchema, {
      type: "routine",
      id: "call-review",
    });
    expect(result).toBe(false);
  });

  it("rejects empty target", () => {
    const result = Value.Check(RoutineRefInstructionSchema, {
      type: "routine",
      id: "call-review",
      target: "",
    });
    expect(result).toBe(false);
  });

  it("ignores extra unrecognised fields", () => {
    const result = Value.Check(RoutineRefInstructionSchema, {
      type: "routine",
      id: "call-review",
      target: "review",
      routine: "inspect",
    });
    expect(result).toBe(true);
  });
});

describe("isRoutineRefInstruction", () => {
  it("returns true for routine instruction", () => {
    expect(isRoutineRefInstruction({ type: "routine", id: "call-review", target: "review" })).toBe(
      true,
    );
  });

  it("returns false for agent instruction", () => {
    expect(
      isRoutineRefInstruction({
        type: "agent",
        id: "a1",
        systemPrompt: "build",
        prompt: "do it",
      }),
    ).toBe(false);
  });

  it("returns false for loop instruction", () => {
    expect(isRoutineRefInstruction({ type: "loop", id: "l1", maxIterations: 3, steps: [] })).toBe(
      false,
    );
  });

  it("returns false for workspace instruction", () => {
    expect(
      isRoutineRefInstruction({ type: "workspace", id: "ws1", provider: "git-worktree" }),
    ).toBe(false);
  });
});

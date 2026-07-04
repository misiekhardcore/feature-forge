import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowContext, type InstructionResult } from "./FlowContext";

function makeHandle(filePath: string): WorkspaceHandle {
  return new WorkspaceHandle(filePath, new Date("2025-01-01"));
}

function makeResult(overrides: Partial<InstructionResult> = {}): InstructionResult {
  return {
    raw: "mock output",
    ...overrides,
  };
}

function makePassedResult(): InstructionResult {
  return {
    raw: "all good",
    parsed: {
      kind: "review" as const,
      passed: true,
      findings: { critical: [], warnings: [], info: [] },
    },
  };
}

function makeFailedResult(critical: string[]): InstructionResult {
  return {
    raw: "issues found",
    parsed: {
      kind: "review" as const,
      passed: false,
      findings: { critical, warnings: [], info: [] },
    },
  };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("FlowContext", () => {
  describe("construction", () => {
    it("initialises with required fields and sensible defaults", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "add auth",
      });
      expect(ctx.prompt).toBe("add auth");
      expect(ctx.results.size).toBe(0);
      expect(ctx.workspaces.size).toBe(0);
      expect(ctx.params.size).toBe(0);
      expect(ctx.feedback).toBeUndefined();
      expect(ctx.iteration).toBe(0);
    });

    it("initialises with all optional fields", () => {
      const workspaces = new Map([["ws", makeHandle("/tmp/ws")]]);
      const params = new Map([["plan", "use JWT"]]);
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces,
        params,
        feedback: "fix x",
        iteration: 2,
      });
      expect(ctx.workspaces.get("ws")!.path).toBe("/tmp/ws");
      expect(ctx.params.get("plan")).toBe("use JWT");
      expect(ctx.feedback).toBe("fix x");
      expect(ctx.iteration).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // withResult
  // -----------------------------------------------------------------------

  describe("withResult", () => {
    it("stores a result and returns a new context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const result = makeResult({ raw: "hello" });
      const next = ctx.withResult("builder", result);

      // Original unchanged
      expect(ctx.results.size).toBe(0);

      // New context has the result
      expect(next.results.size).toBe(1);
      expect(next.results.get("builder")).toBe(result);
    });

    it("does not mutate the original context's results map", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      ctx.withResult("a", makeResult());
      expect(ctx.results.size).toBe(0);
    });

    it("overwrites an existing result for the same id", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const first = ctx.withResult("a", makeResult({ raw: "first" }));
      const second = first.withResult("a", makeResult({ raw: "second" }));

      expect(first.results.get("a")!.raw).toBe("first");
      expect(second.results.get("a")!.raw).toBe("second");
    });
  });

  // -----------------------------------------------------------------------
  // withWorkspace
  // -----------------------------------------------------------------------

  describe("withWorkspace", () => {
    it("stores a workspace handle by name", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const handle = makeHandle("/tmp/ws");
      const next = ctx.withWorkspace("ws", handle);
      expect(next.workspaces.get("ws")).toBe(handle);
    });

    it("does not mutate the original context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      ctx.withWorkspace("ws", makeHandle("/tmp/ws"));
      expect(ctx.workspaces.size).toBe(0);
    });

    it("overwrites an existing workspace with the same name", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const first = ctx.withWorkspace("ws", makeHandle("/tmp/ws1"));
      const second = first.withWorkspace("ws", makeHandle("/tmp/ws2"));

      expect(first.workspaces.get("ws")!.path).toBe("/tmp/ws1");
      expect(second.workspaces.get("ws")!.path).toBe("/tmp/ws2");
    });
  });

  // -----------------------------------------------------------------------
  // withWorkspaceCleared
  // -----------------------------------------------------------------------

  describe("withWorkspaceCleared", () => {
    it("removes a workspace by name", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withWorkspace("ws", makeHandle("/tmp/ws"));
      const next = ctx.withWorkspaceCleared("ws");
      expect(next.workspaces.has("ws")).toBe(false);
    });

    it("does not mutate the original context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withWorkspace("ws", makeHandle("/tmp/ws"));
      ctx.withWorkspaceCleared("ws");
      expect(ctx.workspaces.has("ws")).toBe(true);
    });

    it("is a no-op for non-existent workspace name", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const next = ctx.withWorkspaceCleared("nonexistent");
      expect(next.workspaces.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getWorkspacePath
  // -----------------------------------------------------------------------

  describe("getWorkspacePath", () => {
    it("returns the path of a known workspace", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withWorkspace("ws", makeHandle("/tmp/ws"));
      expect(ctx.getWorkspacePath("ws")).toBe("/tmp/ws");
    });

    it("returns undefined for unknown workspace", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.getWorkspacePath("nonexistent")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // withParams
  // -----------------------------------------------------------------------

  describe("withParams", () => {
    it("stores params and returns a new context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const next = ctx.withParams({ plan: "use JWT", prompt: "add auth" });
      expect(next.params.get("plan")).toBe("use JWT");
      expect(next.params.get("prompt")).toBe("add auth");
    });

    it("replaces existing params entirely", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
        params: new Map([["plan", "old"]]),
      });
      const next = ctx.withParams({ prompt: "new task" });
      expect(next.params.size).toBe(1);
      expect(next.params.has("plan")).toBe(false);
      expect(next.params.get("prompt")).toBe("new task");
    });

    it("does not mutate the original context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      ctx.withParams({ plan: "x" });
      expect(ctx.params.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // withFeedback
  // -----------------------------------------------------------------------

  describe("withFeedback", () => {
    it("replaces feedback", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withFeedback("[review] CRITICAL: fix");
      expect(ctx.feedback).toBe("[review] CRITICAL: fix");
    });
  });

  // -----------------------------------------------------------------------
  // withIteration
  // -----------------------------------------------------------------------

  describe("withIteration", () => {
    it("sets the iteration counter", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withIteration(3);
      expect(ctx.iteration).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // withResultsCleared
  // -----------------------------------------------------------------------

  describe("withResultsCleared", () => {
    it("removes specified ids while keeping others", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      })
        .withResult("a", makeResult())
        .withResult("b", makeResult())
        .withResult("c", makeResult());

      const next = ctx.withResultsCleared(new Set(["a", "c"]));

      expect(next.results.size).toBe(1);
      expect(next.results.has("b")).toBe(true);
      expect(next.results.has("a")).toBe(false);
      expect(next.results.has("c")).toBe(false);
    });

    it("does not mutate the original context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("a", makeResult());

      ctx.withResultsCleared(new Set(["a"]));

      expect(ctx.results.size).toBe(1);
      expect(ctx.results.has("a")).toBe(true);
    });

    it("is a no-op for ids not in the results map", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("a", makeResult());
      const next = ctx.withResultsCleared(new Set(["nonexistent"]));
      expect(next.results.size).toBe(1);
    });

    it("is a no-op for an empty set", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("a", makeResult());
      const next = ctx.withResultsCleared(new Set());
      expect(next.results.size).toBe(1);
    });

    it("clears loop-internal results between iterations", () => {
      // Simulates two loop iterations — iteration 2 should not see
      // results from iteration 1 for loop-internal instructions.
      let ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      // Iteration 1: build + review run, produce results
      ctx = ctx.withResult("builder", makeResult({ raw: "round 1 build" }));
      ctx = ctx.withResult("review", makePassedResult());

      expect(ctx.results.get("builder")!.raw).toBe("round 1 build");

      // Between iterations: clear loop-internal results
      ctx = ctx.withResultsCleared(new Set(["builder", "review"]));

      // Iteration 2 starts fresh
      expect(ctx.results.has("builder")).toBe(false);
      expect(ctx.results.has("review")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // resolve — template placeholders
  // -----------------------------------------------------------------------

  describe("resolve", () => {
    it("resolves {{prompt}}", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "add auth",
      });
      expect(ctx.resolve("Build: {{prompt}}")).toBe("Build: add auth");
    });

    it("resolves {{feedback}} with a default when none set", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("Feedback: {{feedback}}")).toBe("Feedback: (no prior findings)");
    });

    it("resolves {{feedback}} from the context", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
        feedback: "fix validation",
      });
      expect(ctx.resolve("Feedback: {{feedback}}")).toBe("Feedback: fix validation");
    });

    it("resolves {{workspace.<name>}} to the workspace path", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withWorkspace("ws", makeHandle("/tmp/ws"));
      expect(ctx.resolve("Workspace: {{workspace.ws}}")).toBe("Workspace: /tmp/ws");
    });

    it("resolves {{workspace.<name>}} as empty string when not set", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("{{workspace.ws}}")).toBe("");
    });

    it("resolves param placeholders via params map", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
        params: new Map([["plan", "use JWT"]]),
      });
      expect(ctx.resolve("Plan: {{plan}}")).toBe("Plan: use JWT");
    });

    it("resolves param placeholder as {{key}} when param not in map", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("{{plan}}")).toBe("{{plan}}");
    });

    it("resolves {{results.<id>.raw}}", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("builder", makeResult({ raw: "created auth.ts" }));
      expect(ctx.resolve("Output: {{results.builder.raw}}")).toBe("Output: created auth.ts");
    });

    it("resolves {{results.<id>.raw}} as empty for missing id", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("{{results.missing.raw}}")).toBe("");
    });

    it("resolves {{results.<id>.parsed.passed}}", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("review", makePassedResult());
      expect(ctx.resolve("Passed: {{results.review.parsed.passed}}")).toBe("Passed: true");
    });

    it("resolves {{results.<id>.parsed.passed}} for failed", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("review", makeFailedResult(["no validation"]));
      expect(ctx.resolve("Passed: {{results.review.parsed.passed}}")).toBe("Passed: false");
    });

    it("resolves nested parsed field as empty for unparsed result", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      }).withResult("builder", makeResult({ raw: "done", parsed: undefined }));
      expect(ctx.resolve("{{results.builder.parsed.passed}}")).toBe("");
    });

    it("resolves nested parsed field as empty for missing id", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("{{results.missing.parsed.passed}}")).toBe("");
    });

    it("replaces multiple placeholders in one template", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "add auth",
      })
        .withWorkspace("ws", makeHandle("/ws"))
        .withParams({ plan: "use JWT" });
      expect(ctx.resolve("Task: {{prompt}} | Plan: {{plan}} | WS: {{workspace.ws}}")).toBe(
        "Task: add auth | Plan: use JWT | WS: /ws",
      );
    });

    it("leaves unknown placeholders unchanged", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      expect(ctx.resolve("Hello {{UNKNOWN}}")).toBe("Hello {{UNKNOWN}}");
    });
  });

  // -----------------------------------------------------------------------
  // Immutability — chaining
  // -----------------------------------------------------------------------

  describe("immutability", () => {
    it("supports fluent chaining without mutating intermediates", () => {
      const ctx = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const ctx2 = ctx.withWorkspace("ws", makeHandle("/tmp/ws"));
      const ctx3 = ctx2.withFeedback("f");
      const ctx4 = ctx3.withIteration(1);

      // Each is independent
      expect(ctx.workspaces.size).toBe(0);
      expect(ctx2.workspaces.get("ws")!.path).toBe("/tmp/ws");
      expect(ctx2.feedback).toBeUndefined();
      expect(ctx3.workspaces.get("ws")!.path).toBe("/tmp/ws");
      expect(ctx3.feedback).toBe("f");
      expect(ctx4.workspaces.get("ws")!.path).toBe("/tmp/ws");
      expect(ctx4.feedback).toBe("f");
      expect(ctx4.iteration).toBe(1);
    });
  });
});

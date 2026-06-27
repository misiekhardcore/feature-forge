import { describe, expect, it } from "vitest";

import { FlowContext, type InstructionResult } from "./FlowContext";

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
      const ctx = new FlowContext(new Map(), "add auth", "plan: use JWT");
      expect(ctx.task).toBe("add auth");
      expect(ctx.plan).toBe("plan: use JWT");
      expect(ctx.results.size).toBe(0);
      expect(ctx.workspace).toBeUndefined();
      expect(ctx.feedback).toBeUndefined();
      expect(ctx.iteration).toBe(0);
    });

    it("initialises with all optional fields", () => {
      const ctx = new FlowContext(new Map(), "task", "plan", "/tmp/ws", "fix x", undefined, 2);
      expect(ctx.workspace).toBe("/tmp/ws");
      expect(ctx.feedback).toBe("fix x");
      expect(ctx.iteration).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // withResult
  // -----------------------------------------------------------------------

  describe("withResult", () => {
    it("stores a result and returns a new context", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      const result = makeResult({ raw: "hello" });
      const next = ctx.withResult("builder", result);

      // Original unchanged
      expect(ctx.results.size).toBe(0);

      // New context has the result
      expect(next.results.size).toBe(1);
      expect(next.results.get("builder")).toBe(result);
    });

    it("does not mutate the original context's results map", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      ctx.withResult("a", makeResult());
      expect(ctx.results.size).toBe(0);
    });

    it("overwrites an existing result for the same id", () => {
      const ctx = new FlowContext(new Map(), "task", "");
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
    it("sets the workspace path", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      const next = ctx.withWorkspace("/tmp/ws", "ws1");
      expect(next.workspace).toBe("/tmp/ws");
      expect(next.workspaceId).toBe("ws1");
    });

    it("does not mutate the original context", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      ctx.withWorkspace("/tmp/ws", "ws1");
      expect(ctx.workspace).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // withFeedback
  // -----------------------------------------------------------------------

  describe("withFeedback", () => {
    it("replaces feedback", () => {
      const ctx = new FlowContext(new Map(), "task", "").withFeedback("[review] CRITICAL: fix");
      expect(ctx.feedback).toBe("[review] CRITICAL: fix");
    });
  });

  // -----------------------------------------------------------------------
  // withIteration
  // -----------------------------------------------------------------------

  describe("withIteration", () => {
    it("sets the iteration counter", () => {
      const ctx = new FlowContext(new Map(), "task", "").withIteration(3);
      expect(ctx.iteration).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // withResultsCleared
  // -----------------------------------------------------------------------

  describe("withResultsCleared", () => {
    it("removes specified ids while keeping others", () => {
      const ctx = new FlowContext(new Map(), "task", "")
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
      const ctx = new FlowContext(new Map(), "task", "").withResult("a", makeResult());

      ctx.withResultsCleared(new Set(["a"]));

      expect(ctx.results.size).toBe(1);
      expect(ctx.results.has("a")).toBe(true);
    });

    it("is a no-op for ids not in the results map", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult("a", makeResult());
      const next = ctx.withResultsCleared(new Set(["nonexistent"]));
      expect(next.results.size).toBe(1);
    });

    it("is a no-op for an empty set", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult("a", makeResult());
      const next = ctx.withResultsCleared(new Set());
      expect(next.results.size).toBe(1);
    });

    it("clears loop-internal results between iterations", () => {
      // Simulates two loop iterations — iteration 2 should not see
      // results from iteration 1 for loop-internal instructions.
      let ctx = new FlowContext(new Map(), "task", "");

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
    it("resolves {{task}}", () => {
      const ctx = new FlowContext(new Map(), "add auth", "");
      expect(ctx.resolve("Build: {{task}}")).toBe("Build: add auth");
    });

    it("resolves {{plan}}", () => {
      const ctx = new FlowContext(new Map(), "task", "use JWT + bcrypt");
      expect(ctx.resolve("Plan: {{plan}}")).toBe("Plan: use JWT + bcrypt");
    });

    it("resolves {{feedback}} with a default when none set", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      expect(ctx.resolve("Feedback: {{feedback}}")).toBe("Feedback: (no prior findings)");
    });

    it("resolves {{feedback}} from the context", () => {
      const ctx = new FlowContext(new Map(), "task", "", undefined, "fix validation");
      expect(ctx.resolve("Feedback: {{feedback}}")).toBe("Feedback: fix validation");
    });

    it("resolves {{workspace}}", () => {
      const ctx = new FlowContext(new Map(), "task", "", "/tmp/ws");
      expect(ctx.resolve("Workspace: {{workspace}}")).toBe("Workspace: /tmp/ws");
    });

    it("resolves {{workspace}} as empty string when not set", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      expect(ctx.resolve("{{workspace}}")).toBe("");
    });

    it("resolves {{results.<id>.raw}}", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult(
        "builder",
        makeResult({ raw: "created auth.ts" }),
      );
      expect(ctx.resolve("Output: {{results.builder.raw}}")).toBe("Output: created auth.ts");
    });

    it("resolves {{results.<id>.raw}} as empty for missing id", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      expect(ctx.resolve("{{results.missing.raw}}")).toBe("");
    });

    it("resolves {{results.<id>.parsed.passed}}", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult("review", makePassedResult());
      expect(ctx.resolve("Passed: {{results.review.parsed.passed}}")).toBe("Passed: true");
    });

    it("resolves {{results.<id>.parsed.passed}} for failed", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult(
        "review",
        makeFailedResult(["no validation"]),
      );
      expect(ctx.resolve("Passed: {{results.review.parsed.passed}}")).toBe("Passed: false");
    });

    it("resolves nested parsed field as empty for unparsed result", () => {
      const ctx = new FlowContext(new Map(), "task", "").withResult(
        "builder",
        makeResult({ raw: "done", parsed: undefined }),
      );
      expect(ctx.resolve("{{results.builder.parsed.passed}}")).toBe("");
    });

    it("resolves nested parsed field as empty for missing id", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      expect(ctx.resolve("{{results.missing.parsed.passed}}")).toBe("");
    });

    it("replaces multiple placeholders in one template", () => {
      const ctx = new FlowContext(new Map(), "add auth", "use JWT", "/ws");
      expect(ctx.resolve("Task: {{task}} | Plan: {{plan}} | WS: {{workspace}}")).toBe(
        "Task: add auth | Plan: use JWT | WS: /ws",
      );
    });

    it("leaves unknown placeholders unchanged", () => {
      const ctx = new FlowContext(new Map(), "task", "");
      expect(ctx.resolve("Hello {{UNKNOWN}}")).toBe("Hello {{UNKNOWN}}");
    });
  });

  // -----------------------------------------------------------------------
  // Immutability — chaining
  // -----------------------------------------------------------------------

  describe("immutability", () => {
    it("supports fluent chaining without mutating intermediates", () => {
      const ctx = new FlowContext(new Map(), "task", "");

      const ctx2 = ctx.withWorkspace("/tmp/ws", "ws1");
      const ctx3 = ctx2.withFeedback("f");
      const ctx4 = ctx3.withIteration(1);

      // Each is independent
      expect(ctx.workspace).toBeUndefined();
      expect(ctx2.workspace).toBe("/tmp/ws");
      expect(ctx2.feedback).toBeUndefined();
      expect(ctx3.workspace).toBe("/tmp/ws");
      expect(ctx3.feedback).toBe("f");
      expect(ctx4.workspace).toBe("/tmp/ws");
      expect(ctx4.feedback).toBe("f");
      expect(ctx4.iteration).toBe(1);
    });
  });
});

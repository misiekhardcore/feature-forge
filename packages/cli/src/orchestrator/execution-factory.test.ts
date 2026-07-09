import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { createChildExecutionContext } from "./execution-factory";
import { FlowContext } from "./FlowContext";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "./MaxDepthExceededError";

// ── Helpers ──────────────────────────────────────────────────

function makeHandle(filePath: string): WorkspaceHandle {
  return new WorkspaceHandle(filePath, new Date("2025-01-01"));
}

// ── Tests ────────────────────────────────────────────────────

describe("createChildExecutionContext", () => {
  it("returns a new FlowContext with incremented depth", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: 0,
    });

    const child = createChildExecutionContext(parent);

    expect(child).not.toBe(parent);
    expect(child.depth).toBe(1);
  });

  it("increments depth from a non-zero starting depth", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: 2,
    });

    const child = createChildExecutionContext(parent);

    expect(child.depth).toBe(3);
  });

  it("returns a context with empty results map", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
    }).withResult("step1", { raw: "done" });

    const child = createChildExecutionContext(parent);

    expect(child.results.size).toBe(0);
    // Parent unchanged.
    expect(parent.results.size).toBe(1);
  });

  it("copies workspace references from the parent", () => {
    const handle = makeHandle("/tmp/ws");
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
    }).withWorkspace("ws", handle);

    const child = createChildExecutionContext(parent);

    expect(child.workspaces.get("ws")).toBe(handle);
    expect(child.getWorkspacePath("ws")).toBe("/tmp/ws");
  });

  it("initialises with an empty params map", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      params: new Map([["plan", "use JWT"]]),
    });

    const child = createChildExecutionContext(parent);

    expect(child.params.size).toBe(0);
    // Parent unchanged.
    expect(parent.params.get("plan")).toBe("use JWT");
  });

  it("resets iteration and feedback to defaults", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      accumulatedFeedback: "fix x",
      iteration: 3,
    });

    const child = createChildExecutionContext(parent);

    expect(child.accumulatedFeedback).toBeUndefined();
    expect(child.iteration).toBe(0);
  });

  it("throws MaxDepthExceededError at the maximum depth limit", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: MAX_NESTING_DEPTH,
    });

    expect(() => createChildExecutionContext(parent)).toThrow(MaxDepthExceededError);
  });

  it("throws MaxDepthExceededError when exceeding the limit", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: MAX_NESTING_DEPTH + 1,
    });

    expect(() => createChildExecutionContext(parent)).toThrow(MaxDepthExceededError);
  });

  it("includes the depth in the error message", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: MAX_NESTING_DEPTH,
    });

    try {
      createChildExecutionContext(parent);
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MaxDepthExceededError);
      expect((error as Error).message).toContain(String(MAX_NESTING_DEPTH + 1));
    }
  });

  it("allows depth up to MAX_NESTING_DEPTH - 1", () => {
    const parent = new FlowContext({
      results: new Map(),
      prompt: "task",
      depth: MAX_NESTING_DEPTH - 1,
    });

    const child = createChildExecutionContext(parent);

    expect(child.depth).toBe(MAX_NESTING_DEPTH);
  });
});

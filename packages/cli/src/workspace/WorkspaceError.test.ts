import { describe, expect, it } from "vitest";

import {
  DirtyWorkingTreeError,
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";

describe("WorkspaceError", () => {
  it("creates an error with a message and correct name", () => {
    const error = new WorkspaceError("workspace creation failed");
    expect(error.message).toBe("workspace creation failed");
    expect(error.name).toBe("WorkspaceError");
    expect(error).toBeInstanceOf(Error);
  });

  it("chains a cause error", () => {
    const cause = new Error("disk full");
    const error = new WorkspaceError("workspace creation failed", cause);
    expect(error.cause).toBe(cause);
  });

  it("accepts undefined cause", () => {
    const error = new WorkspaceError("workspace creation failed");
    expect(error.cause).toBeUndefined();
  });
});

describe("DirtyWorkingTreeError", () => {
  it("has a sensible default message", () => {
    const error = new DirtyWorkingTreeError();
    expect(error.message).toBe("Working tree has uncommitted changes");
    expect(error.name).toBe("DirtyWorkingTreeError");
  });

  it("extends WorkspaceError", () => {
    const error = new DirtyWorkingTreeError();
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toBeInstanceOf(Error);
  });

  it("accepts a custom message", () => {
    const error = new DirtyWorkingTreeError("repo has 3 dirty files");
    expect(error.message).toBe("repo has 3 dirty files");
  });

  it("chains a cause error", () => {
    const cause = new Error("git status failed");
    const error = new DirtyWorkingTreeError(undefined, cause);
    expect(error.cause).toBe(cause);
  });
});

describe("WorktreeBranchExistsError", () => {
  it("includes the branch name in the message", () => {
    const error = new WorktreeBranchExistsError("forge/my-task");
    expect(error.message).toBe("Branch already exists: forge/my-task");
    expect(error.name).toBe("WorktreeBranchExistsError");
  });

  it("extends WorkspaceError", () => {
    const error = new WorktreeBranchExistsError("forge/x");
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toBeInstanceOf(Error);
  });

  it("chains a cause error", () => {
    const cause = new Error("branch listing failed");
    const error = new WorktreeBranchExistsError("forge/x", cause);
    expect(error.cause).toBe(cause);
  });
});

describe("WorktreePathExistsError", () => {
  it("includes the path in the message", () => {
    const error = new WorktreePathExistsError("/tmp/.forge/worktrees/stale");
    expect(error.message).toBe("Worktree path already exists: /tmp/.forge/worktrees/stale");
    expect(error.name).toBe("WorktreePathExistsError");
  });

  it("extends WorkspaceError", () => {
    const error = new WorktreePathExistsError("/tmp/x");
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toBeInstanceOf(Error);
  });

  it("chains a cause error", () => {
    const cause = new Error("stat check failed");
    const error = new WorktreePathExistsError("/tmp/x", cause);
    expect(error.cause).toBe(cause);
  });
});

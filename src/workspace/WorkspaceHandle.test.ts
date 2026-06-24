import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "./WorkspaceHandle";

describe("WorkspaceHandle", () => {
  const createdAt = new Date("2026-06-24T12:00:00.000Z");
  const handle = new WorkspaceHandle("task-1", "/tmp/.forge/worktrees/task-1", createdAt);

  it("stores id, path, and createdAt", () => {
    expect(handle.id).toBe("task-1");
    expect(handle.path).toBe("/tmp/.forge/worktrees/task-1");
    expect(handle.createdAt).toBe(createdAt);
  });

  describe("equals", () => {
    it("returns true for handles with the same id and path", () => {
      const other = new WorkspaceHandle("task-1", "/tmp/.forge/worktrees/task-1", createdAt);
      expect(handle.equals(other)).toBe(true);
    });

    it("returns false when id differs", () => {
      const other = new WorkspaceHandle("task-2", "/tmp/.forge/worktrees/task-1", createdAt);
      expect(handle.equals(other)).toBe(false);
    });

    it("returns false when path differs", () => {
      const other = new WorkspaceHandle("task-1", "/tmp/other", createdAt);
      expect(handle.equals(other)).toBe(false);
    });

    it("ignores createdAt in comparison", () => {
      const other = new WorkspaceHandle(
        "task-1",
        "/tmp/.forge/worktrees/task-1",
        new Date("2025-01-01T00:00:00.000Z"),
      );
      expect(handle.equals(other)).toBe(true);
    });
  });

  describe("toJSON", () => {
    it("serializes all fields to plain object", () => {
      expect(handle.toJSON()).toEqual({
        id: "task-1",
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      });
    });

    it("serializes createdAt as ISO string", () => {
      const partialHandle = new WorkspaceHandle("x", "/x", new Date("2026-01-15T08:30:00.000Z"));
      expect(partialHandle.toJSON().createdAt).toBe("2026-01-15T08:30:00.000Z");
    });
  });

  describe("fromJSON", () => {
    it("deserializes a plain object back to a handle", () => {
      const restored = WorkspaceHandle.fromJSON({
        id: "task-1",
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      });

      expect(restored.id).toBe("task-1");
      expect(restored.path).toBe("/tmp/.forge/worktrees/task-1");
      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.createdAt.getTime()).toBe(createdAt.getTime());
    });

    it("round-trips through toJSON → fromJSON", () => {
      const json = handle.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.equals(handle)).toBe(true);
      expect(restored.id).toBe(handle.id);
      expect(restored.path).toBe(handle.path);
      expect(restored.createdAt.getTime()).toBe(handle.createdAt.getTime());
    });
  });
});

import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "./WorkspaceHandle";

describe("WorkspaceHandle", () => {
  const createdAt = new Date("2026-06-24T12:00:00.000Z");
  const handle = new WorkspaceHandle("/tmp/.forge/worktrees/task-1", createdAt);
  const handleWithBranch = new WorkspaceHandle(
    "/tmp/.forge/worktrees/task-1",
    createdAt,
    "forge/ws-abc123",
  );

  it("stores path and createdAt", () => {
    expect(handle.path).toBe("/tmp/.forge/worktrees/task-1");
    expect(handle.createdAt).toBe(createdAt);
  });

  describe("equals", () => {
    it("returns true for handles with the same path", () => {
      const other = new WorkspaceHandle("/tmp/.forge/worktrees/task-1", createdAt);
      expect(handle.equals(other)).toBe(true);
    });

    it("returns false when path differs", () => {
      const other = new WorkspaceHandle("/tmp/other", createdAt);
      expect(handle.equals(other)).toBe(false);
    });

    it("ignores createdAt in comparison", () => {
      const other = new WorkspaceHandle(
        "/tmp/.forge/worktrees/task-1",
        new Date("2025-01-01T00:00:00.000Z"),
      );
      expect(handle.equals(other)).toBe(true);
    });
  });

  describe("toJSON", () => {
    it("serializes all fields to plain object", () => {
      expect(handle.toJSON()).toEqual({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      });
    });

    it("serializes createdAt as ISO string", () => {
      const partialHandle = new WorkspaceHandle("/x", new Date("2026-01-15T08:30:00.000Z"));
      expect(partialHandle.toJSON().createdAt).toBe("2026-01-15T08:30:00.000Z");
    });

    it("includes branch when set", () => {
      const json = handleWithBranch.toJSON();
      expect(json.branch).toBe("forge/ws-abc123");
    });

    it("omits branch when not set", () => {
      const json = handle.toJSON();
      expect(json.branch).toBeUndefined();
    });
  });

  describe("fromJSON", () => {
    it("deserializes a plain object back to a handle", () => {
      const restored = WorkspaceHandle.fromJSON({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      });

      expect(restored.path).toBe("/tmp/.forge/worktrees/task-1");
      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.createdAt.getTime()).toBe(createdAt.getTime());
    });

    it("round-trips through toJSON → fromJSON", () => {
      const json = handle.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.equals(handle)).toBe(true);
      expect(restored.path).toBe(handle.path);
      expect(restored.createdAt.getTime()).toBe(handle.createdAt.getTime());
    });

    it("restores branch from JSON", () => {
      const json = handleWithBranch.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.branch).toBe("forge/ws-abc123");
    });

    it("handles missing branch in fromJSON", () => {
      const restored = WorkspaceHandle.fromJSON({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      });
      expect(restored.branch).toBeUndefined();
    });

    it("stores branch on the handle", () => {
      expect(handleWithBranch.branch).toBe("forge/ws-abc123");
    });

    it("omits branch when not provided", () => {
      expect(handle.branch).toBeUndefined();
    });
  });
});

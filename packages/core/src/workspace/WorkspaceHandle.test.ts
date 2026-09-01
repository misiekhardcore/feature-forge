import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "./WorkspaceHandle";

describe("WorkspaceHandle", () => {
  const createdAt = new Date("2026-06-24T12:00:00.000Z");
  const handle = new WorkspaceHandle("/tmp/.forge/worktrees/task-1", createdAt, "forge/ws-abc123");
  const handleWithSession = new WorkspaceHandle(
    "/tmp/.forge/worktrees/task-2",
    createdAt,
    "forge/ws-def456",
    "sess-001",
  );

  it("stores path, createdAt and branch", () => {
    expect(handle.path).toBe("/tmp/.forge/worktrees/task-1");
    expect(handle.createdAt).toBe(createdAt);
    expect(handle.branch).toBe("forge/ws-abc123");
  });

  it("stores an optional sessionId", () => {
    expect(handleWithSession.sessionId).toBe("sess-001");
    expect(handle.sessionId).toBeUndefined();
  });

  describe("equals", () => {
    it("returns true for handles with the same path", () => {
      const other = new WorkspaceHandle(
        "/tmp/.forge/worktrees/task-1",
        createdAt,
        "forge/ws-abc123",
      );
      expect(handle.equals(other)).toBe(true);
    });

    it("returns false when path differs", () => {
      const other = new WorkspaceHandle("/tmp/other", createdAt, "forge/ws-abc123");
      expect(handle.equals(other)).toBe(false);
    });

    it("ignores createdAt and branch in comparison", () => {
      const other = new WorkspaceHandle(
        "/tmp/.forge/worktrees/task-1",
        new Date("2025-01-01T00:00:00.000Z"),
        "forge/ws-other",
      );
      expect(handle.equals(other)).toBe(true);
    });
  });

  describe("toJSON", () => {
    it("serializes all fields to plain object", () => {
      expect(handle.toJSON()).toEqual({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
        branch: "forge/ws-abc123",
      });
    });

    it("serializes createdAt as ISO string", () => {
      const partialHandle = new WorkspaceHandle(
        "/x",
        new Date("2026-01-15T08:30:00.000Z"),
        "forge/x",
      );
      expect(partialHandle.toJSON().createdAt).toBe("2026-01-15T08:30:00.000Z");
    });

    it("always includes branch", () => {
      expect(handle.toJSON().branch).toBe("forge/ws-abc123");
    });

    it("includes sessionId when set", () => {
      const json = handleWithSession.toJSON();
      expect(json.sessionId).toBe("sess-001");
    });

    it("omits sessionId when not set", () => {
      expect(handle.toJSON().sessionId).toBeUndefined();
    });
  });

  describe("fromJSON", () => {
    it("deserializes a plain object back to a handle", () => {
      const restored = WorkspaceHandle.fromJSON({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
        branch: "forge/ws-abc123",
      });

      expect(restored.path).toBe("/tmp/.forge/worktrees/task-1");
      expect(restored.createdAt).toBeInstanceOf(Date);
      expect(restored.createdAt.getTime()).toBe(createdAt.getTime());
      expect(restored.branch).toBe("forge/ws-abc123");
    });

    it("round-trips through toJSON → fromJSON", () => {
      const json = handle.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.equals(handle)).toBe(true);
      expect(restored.path).toBe(handle.path);
      expect(restored.createdAt.getTime()).toBe(handle.createdAt.getTime());
      expect(restored.branch).toBe(handle.branch);
    });

    it("restores branch from JSON", () => {
      const json = handle.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.branch).toBe("forge/ws-abc123");
    });

    it("round-trips sessionId through toJSON → fromJSON", () => {
      const json = handleWithSession.toJSON();
      const restored = WorkspaceHandle.fromJSON(json);
      expect(restored.sessionId).toBe("sess-001");
    });

    it("leaves sessionId undefined when absent from JSON", () => {
      const restored = WorkspaceHandle.fromJSON({
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
        branch: "forge/ws-abc123",
      });
      expect(restored.sessionId).toBeUndefined();
    });

    it("throws when branch is missing at runtime", () => {
      const legacy = {
        path: "/tmp/.forge/worktrees/task-1",
        createdAt: "2026-06-24T12:00:00.000Z",
      } as unknown as Parameters<typeof WorkspaceHandle.fromJSON>[0];

      expect(() => WorkspaceHandle.fromJSON(legacy)).toThrow(/requires a non-empty branch/);
    });

    it("throws on an empty branch string", () => {
      expect(() =>
        WorkspaceHandle.fromJSON({
          path: "/tmp/.forge/worktrees/task-1",
          createdAt: "2026-06-24T12:00:00.000Z",
          branch: "",
        }),
      ).toThrow(/requires a non-empty branch/);
    });

    it("throws on an unparseable createdAt", () => {
      expect(() =>
        WorkspaceHandle.fromJSON({
          path: "/tmp/.forge/worktrees/task-1",
          createdAt: "not-a-date",
          branch: "forge/ws-abc123",
        }),
      ).toThrow(/requires a parseable createdAt/);
    });

    it("throws when createdAt is missing at runtime", () => {
      const legacy = {
        path: "/tmp/.forge/worktrees/task-1",
        branch: "forge/ws-abc123",
      } as unknown as Parameters<typeof WorkspaceHandle.fromJSON>[0];

      expect(() => WorkspaceHandle.fromJSON(legacy)).toThrow(/requires a parseable createdAt/);
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logging";
import { WorkspaceError } from "./WorkspaceError";
import type { WorktreeRegistryEntry } from "./WorktreeRegistryCodec";
import { WorktreeRegistryCodec } from "./WorktreeRegistryCodec";

const entry = (overrides: Partial<WorktreeRegistryEntry> = {}): WorktreeRegistryEntry => ({
  path: "/repo/.forge/worktrees/ws-example",
  createdAt: "2026-08-18T12:00:00.000Z",
  branch: "forge/ws-example",
  ...overrides,
});

describe("WorktreeRegistryCodec", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("serialize", () => {
    it("emits a v1 envelope with 2-space indentation", () => {
      const raw = WorktreeRegistryCodec.serialize([
        entry({ path: "/repo/.forge/worktrees/ws-a", branch: "forge/ws-a" }),
      ]);
      expect(raw).toBe(
        [
          "{",
          '  "version": 1,',
          '  "worktrees": [',
          "    {",
          '      "path": "/repo/.forge/worktrees/ws-a",',
          '      "createdAt": "2026-08-18T12:00:00.000Z",',
          '      "branch": "forge/ws-a"',
          "    }",
          "  ]",
          "}",
        ].join("\n"),
      );
    });

    it("includes sessionId only when present", () => {
      const raw = WorktreeRegistryCodec.serialize([entry({ sessionId: "sess-1" })]);
      expect(raw).toContain('"sessionId": "sess-1"');
    });

    it("round-trips through parse", () => {
      const entries = [entry(), entry({ path: "/b", branch: "forge/b", sessionId: "sess-2" })];
      const parsed = WorktreeRegistryCodec.parse(WorktreeRegistryCodec.serialize(entries));
      expect(parsed).toEqual({ version: 1, worktrees: entries });
    });

    it("rejects an entry with an empty branch", () => {
      expect(() => WorktreeRegistryCodec.serialize([entry({ branch: "" })])).toThrowError(
        WorkspaceError,
      );
    });

    it("rejects an entry with an unparseable createdAt", () => {
      expect(() =>
        WorktreeRegistryCodec.serialize([entry({ createdAt: "not-a-date" })]),
      ).toThrowError(WorkspaceError);
    });

    it("reports the offending entry index in the error", () => {
      expect(() => WorktreeRegistryCodec.serialize([entry(), entry({ branch: "" })])).toThrowError(
        /\/worktrees\/1\/branch/,
      );
    });
  });

  describe("parse - v1 envelope", () => {
    it("returns the file for a valid envelope", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [entry(), entry({ path: "/b", branch: "forge/b", sessionId: "sess-1" })],
      });
      expect(WorktreeRegistryCodec.parse(raw)).toEqual({
        version: 1,
        worktrees: [entry(), entry({ path: "/b", branch: "forge/b", sessionId: "sess-1" })],
      });
    });

    it("accepts an empty worktrees array", () => {
      expect(WorktreeRegistryCodec.parse('{"version": 1, "worktrees": []}')).toEqual({
        version: 1,
        worktrees: [],
      });
    });

    it("preserves entry order", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [
          entry({ path: "/a", branch: "forge/a" }),
          entry({ path: "/b", branch: "forge/b" }),
          entry({ path: "/c", branch: "forge/c" }),
        ],
      });
      const file = WorktreeRegistryCodec.parse(raw);
      expect(file.worktrees.map((e) => e.path)).toEqual(["/a", "/b", "/c"]);
    });

    it("throws WorkspaceError on invalid JSON", () => {
      expect(() => WorktreeRegistryCodec.parse("{not json")).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError with the underlying parse message on invalid JSON", () => {
      expect(() => WorktreeRegistryCodec.parse("{not json")).toThrow(
        "Failed to parse worktree registry JSON",
      );
    });

    it("throws WorkspaceError on a wrong version", () => {
      const raw = JSON.stringify({ version: 2, worktrees: [] });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on a non-array worktrees field", () => {
      const raw = JSON.stringify({ version: 1, worktrees: "nope" });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on a missing branch field", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [{ path: "/a", createdAt: "2026-08-18T12:00:00.000Z" }],
      });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on an empty path", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [entry({ path: "" })],
      });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on an empty branch", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [entry({ branch: "" })],
      });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on an empty sessionId", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [entry({ sessionId: "" })],
      });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on a top-level non-object (null)", () => {
      expect(() => WorktreeRegistryCodec.parse("null")).toThrow(WorkspaceError);
    });

    it("throws WorkspaceError on an unparseable createdAt", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [entry({ createdAt: "not-a-date" })],
      });
      expect(() => WorktreeRegistryCodec.parse(raw)).toThrow(WorkspaceError);
    });

    it("reports per-field schema details in the error message", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [{ path: "", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a" }],
      });
      try {
        WorktreeRegistryCodec.parse(raw);
        expect.unreachable("expected parse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceError);
        const message = (error as WorkspaceError).message;
        expect(message).toContain("Invalid worktree registry file");
        expect(message).toContain("/worktrees/0/path");
      }
    });

    it("reports the offending entry index for an unparseable createdAt", () => {
      const raw = JSON.stringify({
        version: 1,
        worktrees: [
          entry({ path: "/a", branch: "forge/a" }),
          entry({ path: "/b", branch: "forge/b", createdAt: "garbage" }),
        ],
      });
      try {
        WorktreeRegistryCodec.parse(raw);
        expect.unreachable("expected parse to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkspaceError);
        const message = (error as WorkspaceError).message;
        expect(message).toContain("Invalid worktree registry file");
        expect(message).toContain("/worktrees/1/createdAt");
        expect(message).toContain("garbage");
      }
    });

    it("does not mutate the parsed input", () => {
      const raw = JSON.stringify({ version: 1, worktrees: [entry()] });
      const file = WorktreeRegistryCodec.parse(raw);
      expect(file.worktrees[0]).toEqual(entry());
    });
  });

  describe("parse - v0 legacy array migration", () => {
    it("wraps a bare array into the v1 envelope", () => {
      const raw = JSON.stringify([
        { path: "/a", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a" },
      ]);
      expect(WorktreeRegistryCodec.parse(raw)).toEqual({
        version: 1,
        worktrees: [{ path: "/a", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a" }],
      });
    });

    it("preserves a sessionId on migrated entries", () => {
      const raw = JSON.stringify([
        { path: "/a", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a", sessionId: "s" },
      ]);
      const file = WorktreeRegistryCodec.parse(raw);
      expect(file.worktrees[0].sessionId).toBe("s");
    });

    it("accepts an empty legacy array", () => {
      expect(WorktreeRegistryCodec.parse("[]")).toEqual({ version: 1, worktrees: [] });
    });

    it("drops entries without a branch, logging a warning", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const raw = JSON.stringify([
        { path: "/good", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/good" },
        { path: "/legacy", createdAt: "2026-08-18T12:00:00.000Z" },
      ]);
      const file = WorktreeRegistryCodec.parse(raw);
      expect(file.worktrees).toEqual([
        { path: "/good", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/good" },
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Dropping invalid worktree registry entry during v0 migration",
        expect.objectContaining({ reasons: expect.any(Array) }),
      );
    });

    it("drops entries with an unparseable createdAt, logging a warning", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const raw = JSON.stringify([
        { path: "/good", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/good" },
        { path: "/bad", createdAt: "not-a-date", branch: "forge/bad" },
      ]);
      const file = WorktreeRegistryCodec.parse(raw);
      expect(file.worktrees).toEqual([
        { path: "/good", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/good" },
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "Dropping invalid worktree registry entry during v0 migration",
        expect.objectContaining({
          entry: { path: "/bad", createdAt: "not-a-date", branch: "forge/bad" },
          reasons: ["createdAt: not a parseable date-time string"],
        }),
      );
    });

    it("drops non-object entries, logging a warning", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const file = WorktreeRegistryCodec.parse(
        JSON.stringify([
          "junk",
          { path: "/a", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a" },
        ]),
      );
      expect(file.worktrees).toEqual([
        { path: "/a", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/a" },
      ]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("returns an empty worktrees array when every entry is invalid", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const file = WorktreeRegistryCodec.parse(JSON.stringify([{ path: "" }]));
      expect(file).toEqual({ version: 1, worktrees: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});

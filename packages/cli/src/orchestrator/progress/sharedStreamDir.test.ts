import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ForgeConfig, logger } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedStreamDir } from "./sharedStreamDir";

describe("SharedStreamDir", () => {
  let baseDir: string;

  /** Reset module-level state so each test starts from a clean singleton. */
  function resetState(): void {
    (SharedStreamDir as unknown as { instance: string | undefined }).instance = undefined;
    (SharedStreamDir as unknown as { _swept: boolean })._swept = false;
  }

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "shared-stream-dir-test-"));
    resetState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(baseDir, { recursive: true, force: true });
  });

  /** Create a non-empty `agent-streams-*` dir with an mtime `daysOld` days in the past. */
  function makeStaleDir(name: string, daysOld: number): string {
    const dirPath = join(baseDir, name);
    mkdirSync(dirPath);
    writeFileSync(join(dirPath, "x.stream"), "line\n", "utf-8");
    const old = new Date(Date.now() - daysOld * 86_400_000);
    utimesSync(dirPath, old, old);
    return dirPath;
  }

  /** Point config at the test baseDir with the given retention window. */
  function mockConfig(retentionDays: number): void {
    vi.spyOn(ForgeConfig, "getInstance").mockReturnValue({
      getLogDir: () => baseDir,
      getLogRetentionDays: () => retentionDays,
    } as unknown as ForgeConfig);
  }

  describe("get", () => {
    it("creates an agent-streams dir under baseDir", () => {
      const dir = SharedStreamDir.get(baseDir);

      expect(dir.startsWith(join(baseDir, "agent-streams-"))).toBe(true);
      expect(existsSync(dir)).toBe(true);
    });

    it("returns the same singleton dir on repeated calls", () => {
      const first = SharedStreamDir.get(baseDir);
      const second = SharedStreamDir.get(baseDir);

      expect(second).toBe(first);
    });
  });

  describe("cleanup", () => {
    it("keeps the current singleton and dirs within the retention window", () => {
      mockConfig(7);
      const dir = SharedStreamDir.get(baseDir);
      const recent = makeStaleDir("agent-streams-recent", 1);

      SharedStreamDir.cleanup();

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(recent)).toBe(true);
    });

    it("prunes agent-streams dirs older than the retention window", () => {
      mockConfig(7);
      SharedStreamDir.get(baseDir);
      const stale = makeStaleDir("agent-streams-stale", 10);

      SharedStreamDir.cleanup();

      expect(existsSync(stale)).toBe(false);
    });

    it("retentionDays=0 disables pruning", () => {
      mockConfig(0);
      const stale = makeStaleDir("agent-streams-stale", 10);

      SharedStreamDir.cleanup();

      expect(existsSync(stale)).toBe(true);
    });

    it("is idempotent", () => {
      mockConfig(7);
      SharedStreamDir.get(baseDir);

      expect(() => {
        SharedStreamDir.cleanup();
        SharedStreamDir.cleanup();
      }).not.toThrow();
    });

    it("swallows rmSync failure while pruning a stale dir", () => {
      mockConfig(7);
      const stale = makeStaleDir("agent-streams-stale", 10);
      // Make the dir read-only so rmSync fails with EACCES.
      chmodSync(stale, 0o555);
      try {
        expect(() => SharedStreamDir.cleanup()).not.toThrow();
        expect(existsSync(stale)).toBe(true);
      } finally {
        chmodSync(stale, 0o755);
      }
    });

    it("prunes stale dirs on the startup path (no prior get())", () => {
      mockConfig(7);
      const stale = makeStaleDir("agent-streams-stale", 10);

      SharedStreamDir.cleanup();

      expect(existsSync(stale)).toBe(false);
    });

    it("keeps recent dirs on the startup path (no prior get())", () => {
      mockConfig(7);
      const recent = makeStaleDir("agent-streams-recent", 1);

      SharedStreamDir.cleanup();

      expect(existsSync(recent)).toBe(true);
    });

    it("swallows top-level readdir failure on an unreadable log dir", () => {
      mockConfig(7);
      makeStaleDir("agent-streams-stale", 10);
      const warnSpy = vi.spyOn(logger, "warn");
      // An unreadable base dir makes the top-level readdirSync throw EACCES;
      // cleanup must warn and return instead of escaping initialize().
      chmodSync(baseDir, 0o000);
      try {
        expect(() => SharedStreamDir.cleanup()).not.toThrow();
      } finally {
        chmodSync(baseDir, 0o755);
      }
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to list shared stream dirs during retention pruning",
        expect.objectContaining({ dir: baseDir }),
      );
    });

    it("swallows stat failures on individual dirs", () => {
      mockConfig(7);
      const stale = makeStaleDir("agent-streams-stale", 10);
      const warnSpy = vi.spyOn(logger, "warn");
      // Read-only base dir: listing still works but statting children fails
      // with EACCES — the dir must be warned about and skipped.
      chmodSync(baseDir, 0o400);
      try {
        expect(() => SharedStreamDir.cleanup()).not.toThrow();
      } finally {
        chmodSync(baseDir, 0o755);
      }
      expect(existsSync(stale)).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to stat shared stream dir during retention pruning",
        expect.objectContaining({ dir: stale }),
      );
    });

    it("logs the pruned count when stale dirs are removed", () => {
      mockConfig(7);
      const infoSpy = vi.spyOn(logger, "info");
      makeStaleDir("agent-streams-a", 10);
      makeStaleDir("agent-streams-b", 10);

      SharedStreamDir.cleanup();

      expect(infoSpy).toHaveBeenCalledWith("Pruned stale shared stream dirs", { count: 2 });
    });

    it("does not log a pruned summary when nothing is pruned", () => {
      mockConfig(7);
      const infoSpy = vi.spyOn(logger, "info");
      makeStaleDir("agent-streams-recent", 1);

      SharedStreamDir.cleanup();

      expect(infoSpy).not.toHaveBeenCalled();
    });
  });

  describe("sweepAndPrune", () => {
    it("removes empty agent-streams dirs on first get", () => {
      const stale = join(baseDir, "agent-streams-stale");
      mkdirSync(stale);

      const dir = SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(dir)).toBe(true);
    });

    it("keeps non-empty agent-streams dirs within the retention window", () => {
      const stale = makeStaleDir("agent-streams-stale", 1);
      mockConfig(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });

    it("prunes old non-empty agent-streams dirs", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
    });

    it("prunes old dirs but skips the current singleton", () => {
      const current = SharedStreamDir.get(baseDir);
      // Age the singleton too — it must still be skipped by the instance check.
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(current, old, old);
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(7);

      // Re-arm the once-per-process guard so the sweep runs again with the
      // singleton already created (the sweep would otherwise have run before
      // the first get() created it).
      (SharedStreamDir as unknown as { _swept: boolean })._swept = false;

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(current)).toBe(true);
    });

    it("retentionDays=0 disables pruning", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(0);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });

    it("runs the sweep only once per process", () => {
      const first = join(baseDir, "agent-streams-first");
      mkdirSync(first);

      SharedStreamDir.get(baseDir);
      expect(existsSync(first)).toBe(false);

      // The guard is set after the first sweep — a dir created afterwards
      // survives subsequent get() calls.
      const second = join(baseDir, "agent-streams-second");
      mkdirSync(second);
      SharedStreamDir.get(baseDir);
      expect(existsSync(second)).toBe(true);
    });

    it("swallows top-level readdir failure on an unreadable log dir", () => {
      mockConfig(7);
      makeStaleDir("agent-streams-stale", 10);
      const warnSpy = vi.spyOn(logger, "warn");
      // Write+execute but no read: the sweep's listing fails with EACCES
      // while get() can still create the new instance dir underneath.
      chmodSync(baseDir, 0o300);
      let dir = "";
      try {
        expect(() => {
          dir = SharedStreamDir.get(baseDir);
        }).not.toThrow();
      } finally {
        chmodSync(baseDir, 0o755);
      }
      expect(dir.startsWith(join(baseDir, "agent-streams-"))).toBe(true);
      expect(existsSync(dir)).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to list shared stream dirs during sweep",
        expect.objectContaining({ dir: baseDir }),
      );
    });

    it("swallows per-dir read failures while checking emptiness", () => {
      mockConfig(7);
      const locked = makeStaleDir("agent-streams-locked", 10);
      const warnSpy = vi.spyOn(logger, "warn");
      // An unreadable stale dir cannot be checked for emptiness — the sweep
      // must warn and skip it instead of throwing out of get().
      chmodSync(locked, 0o000);
      try {
        expect(() => SharedStreamDir.get(baseDir)).not.toThrow();
      } finally {
        chmodSync(locked, 0o755);
      }
      expect(existsSync(locked)).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to read shared stream dir during sweep",
        expect.objectContaining({ dir: locked }),
      );
    });

    it("logs the pruned count when old dirs are removed", () => {
      mockConfig(7);
      const infoSpy = vi.spyOn(logger, "info");
      makeStaleDir("agent-streams-a", 10);
      makeStaleDir("agent-streams-b", 10);

      SharedStreamDir.get(baseDir);

      expect(infoSpy).toHaveBeenCalledWith("Pruned stale shared stream dirs", { count: 2 });
    });
  });
});

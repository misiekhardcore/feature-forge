import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeConfig, LogLevel } from "../config";
import { jsonParse } from "../helpers";
import { FileLogger } from "./FileLogger";
import { Logger } from "./Logger";

describe("FileLogger", () => {
  let filePath: string;
  let logger: FileLogger;

  beforeEach(() => {
    filePath = join(
      tmpdir(),
      `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    logger = FileLogger.initialize(filePath);
    Logger.setLogLevel(LogLevel.DEBUG);
  });

  afterEach(async () => {
    // Level filtering is set via Logger.setLogLevel() in individual tests
    await logger.close();
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  });

  function readLines(): Record<string, unknown>[] {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => jsonParse(line));
  }

  describe("construction", () => {
    it("creates the log file on first write", async () => {
      expect(existsSync(filePath)).toBe(false);
      logger.info("hello");
      await logger.close();
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe("JSON Lines output", () => {
    it("writes a JSON object per line for each log call", async () => {
      logger.error("err");
      logger.warn("wrn");
      logger.info("inf");
      logger.debug("dbg");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);

      expect(lines[0].level).toBe("error");
      expect(lines[0].message).toBe("err");

      expect(lines[1].level).toBe("warn");
      expect(lines[1].message).toBe("wrn");

      expect(lines[2].level).toBe("info");
      expect(lines[2].message).toBe("inf");

      expect(lines[3].level).toBe("debug");
      expect(lines[3].message).toBe("dbg");
    });

    it("includes an ISO 8601 timestamp in every entry", async () => {
      logger.info("with time");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("includes optional data when provided", async () => {
      logger.error("with data", { userId: 42, details: { action: "click" } });
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toEqual({ userId: 42, details: { action: "click" } });
    });

    it("omits data field when not provided", async () => {
      logger.info("no data");
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toBeUndefined();
    });

    it("appends to existing file instead of overwriting", async () => {
      logger.info("first");
      await logger.close();

      const logger2 = FileLogger.initialize(filePath);
      logger2.info("second");
      await logger2.close();

      const lines = readLines();
      expect(lines).toHaveLength(2);
      expect(lines[0].message).toBe("first");
      expect(lines[1].message).toBe("second");
    });

    it("writes each entry as a single line of valid JSON", async () => {
      logger.error("line test", { key: "value" });
      await logger.close();

      const raw = readFileSync(filePath, "utf-8");
      const trimmed = raw.trim();
      const lines = trimmed.split("\n");
      expect(lines).toHaveLength(1);
      expect(() => jsonParse(lines[0])).not.toThrow();
      expect(raw.endsWith("\n")).toBe(true);
    });
  });

  describe("writes all levels", () => {
    it("writes debug, info, warn, and error entries", async () => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);
      expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    });
  });

  describe("level filtering", () => {
    it("writes all levels when threshold is debug", async () => {
      const l = FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.DEBUG);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn", "info", "debug"]);
    });

    it("filters debug entries when threshold is info", async () => {
      const l = FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.INFO);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(3);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn", "info"]);
    });

    it("filters info and debug when threshold is warn", async () => {
      const l = FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.WARN);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(2);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn"]);
    });

    it("filters everything except error when threshold is error", async () => {
      const l = FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines.map((entry) => entry.level)).toEqual(["error"]);
    });

    it("does not create a file when no entry meets the threshold", async () => {
      const l = FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      expect(existsSync(filePath)).toBe(false);
    });

    it("does not create a file on construction regardless of level", () => {
      FileLogger.initialize(filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("default log file path", () => {
    it("falls back to .forge/logs by default", () => {
      const defaultPath = FileLogger.getDefaultLogFilePath();
      expect(defaultPath).toContain(".forge/logs");
    });
  });

  describe("edge cases", () => {
    it("handles empty message gracefully", async () => {
      logger.info("");
      await logger.close();

      const lines = readLines();
      expect(lines[0].message).toBe("");
    });

    it("handles messages with special characters", async () => {
      const msg = 'Line 1\nLine 2\twith "quotes" and \\backslashes';
      logger.error(msg);
      await logger.close();

      const lines = readLines();
      expect(lines[0].message).toBe(msg);
    });

    it("handles circular data by catching serialization errors", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // Must not throw — the serializer catches the circular reference error.
      expect(() => logger.error("circular data", circular)).not.toThrow();
    });

    it("close is safe to call multiple times", async () => {
      logger.info("before close");
      await logger.close();
      await logger.close(); // second call should not throw
    });

    it("writes after close are best-effort and do not throw", async () => {
      await logger.close();
      expect(() => logger.info("after close")).not.toThrow();
      expect(() => logger.error("after close", { detail: true })).not.toThrow();
    });

    it("silently drops writes when stream is destroyed", async () => {
      logger.info("before close");
      await logger.close();
      // After close the stream is destroyed — writes must not throw
      logger.warn("after close warn");
      logger.debug("after close debug");

      // Only the pre-close entry should be in the file
      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toBe("before close");
    });

    it("handles undefined data explicitly", async () => {
      logger.warn("explicit undefined", undefined);
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toBeUndefined();
    });

    it("handles null-like values in data", async () => {
      logger.info("nulls", { a: null, b: 0, c: false });
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toEqual({ a: null, b: 0, c: false });
    });
  });

  describe("pruneOldLogs", () => {
    let logDir: string;
    let getInstanceSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logDir = mkdtempSync(join(tmpdir(), "forge-prune-test-"));
      // Point the config at the temp dir so pruning never touches the real
      // log directory (the worktree's .forge/logs symlinks to shared logs).
      getInstanceSpy = vi
        .spyOn(ForgeConfig, "getInstance")
        .mockReturnValue({ getLogDir: () => logDir } as unknown as ForgeConfig);
    });

    afterEach(() => {
      getInstanceSpy.mockRestore();
      rmSync(logDir, { recursive: true, force: true });
    });

    /** Write a `.log` file with an mtime `daysOld` days in the past. */
    function writeLogFile(name: string, daysOld: number): string {
      const fullPath = join(logDir, name);
      writeFileSync(fullPath, "stale entry\n", "utf-8");
      const old = new Date(Date.now() - daysOld * 86_400_000);
      utimesSync(fullPath, old, old);
      return fullPath;
    }

    it("skips pruning entirely when retentionDays <= 0", () => {
      writeLogFile("forge-stale.log", 10);

      FileLogger.pruneOldLogs(0);

      expect(existsSync(join(logDir, "forge-stale.log"))).toBe(true);
    });

    it("deletes files older than the retention window", () => {
      writeLogFile("forge-stale.log", 10);

      FileLogger.pruneOldLogs(7);

      expect(existsSync(join(logDir, "forge-stale.log"))).toBe(false);
    });

    it("keeps files within the retention window", () => {
      writeLogFile("forge-recent.log", 3);

      FileLogger.pruneOldLogs(7);

      expect(existsSync(join(logDir, "forge-recent.log"))).toBe(true);
    });

    it("skips subdirectories", () => {
      const subDir = join(logDir, "agent-streams-abc");
      mkdirSync(subDir);
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(subDir, old, old);

      FileLogger.pruneOldLogs(1);

      expect(existsSync(subDir)).toBe(true);
    });

    it("skips non-.log files", () => {
      const jsonPath = join(logDir, "forge-stale.json");
      writeFileSync(jsonPath, "{}\n", "utf-8");
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(jsonPath, old, old);

      FileLogger.pruneOldLogs(1);

      expect(existsSync(jsonPath)).toBe(true);
    });

    it("skips the current file path", () => {
      writeLogFile("forge-other.log", 10);
      const currentPath = writeLogFile("forge-current.log", 10);

      FileLogger.pruneOldLogs(1, currentPath);

      expect(existsSync(join(logDir, "forge-other.log"))).toBe(false);
      expect(existsSync(currentPath)).toBe(true);
    });

    it("survives stat failures without throwing", () => {
      const lockedPath = join(logDir, "forge-locked.log");
      writeFileSync(lockedPath, "locked\n", "utf-8");
      chmodSync(lockedPath, 0o000);
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(lockedPath, old, old);
      // Strip write permission from the directory so the unlink also fails;
      // pruneOldLogs must swallow per-file failures and keep going.
      chmodSync(logDir, 0o555);

      try {
        expect(() => FileLogger.pruneOldLogs(1)).not.toThrow();
      } finally {
        chmodSync(logDir, 0o755);
      }
    });

    it("handles a missing log dir gracefully", () => {
      const missingDir = join(
        tmpdir(),
        `forge-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      getInstanceSpy.mockReturnValue({ getLogDir: () => missingDir });

      expect(() => FileLogger.pruneOldLogs(1)).not.toThrow();
    });
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { jsonParse } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForgeConfig } from "../config";
import { FileLogger } from "./FileLogger";
import { LogLevel } from "./LogLevel";

describe("FileLogger", () => {
  let filePath: string;
  let originalLogLevel: string | undefined;
  let logger: FileLogger;

  beforeEach(() => {
    originalLogLevel = process.env.FORGE_LOG_LEVEL;
    delete process.env.FORGE_LOG_LEVEL;
    filePath = join(
      tmpdir(),
      `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    logger = FileLogger.initialize(filePath);
  });

  afterEach(async () => {
    if (originalLogLevel !== undefined) {
      process.env.FORGE_LOG_LEVEL = originalLogLevel;
    } else {
      delete process.env.FORGE_LOG_LEVEL;
    }
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
    it("writes all levels when threshold is debug (default)", async () => {
      const l = FileLogger.initialize(filePath);
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
      process.env.FORGE_LOG_LEVEL = LogLevel[LogLevel.INFO];
      const l = FileLogger.initialize(filePath);
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
      process.env.FORGE_LOG_LEVEL = LogLevel[LogLevel.WARN];
      const l = FileLogger.initialize(filePath);
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
      process.env.FORGE_LOG_LEVEL = LogLevel[LogLevel.ERROR];
      const l = FileLogger.initialize(filePath);
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
      process.env.FORGE_LOG_LEVEL = LogLevel[LogLevel.ERROR];
      const l = FileLogger.initialize(filePath);
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      expect(existsSync(filePath)).toBe(false);
    });

    it("does not create a file on construction regardless of level", () => {
      process.env.FORGE_LOG_LEVEL = LogLevel[LogLevel.ERROR];
      FileLogger.initialize(filePath);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("default log file path", () => {
    const originalLogDir = process.env.FORGE_LOG_DIR;

    afterEach(() => {
      if (originalLogDir !== undefined) {
        process.env.FORGE_LOG_DIR = originalLogDir;
      } else {
        delete process.env.FORGE_LOG_DIR;
      }
    });

    it("falls back to .forge/logs when FORGE_LOG_DIR is not set", () => {
      delete process.env.FORGE_LOG_DIR;
      const defaultPath = FileLogger.getDefaultLogFilePath();
      expect(defaultPath).toContain(".forge/logs");
    });

    it("uses FORGE_LOG_DIR when set", () => {
      process.env.FORGE_LOG_DIR = "/custom/log/dir";
      const defaultPath = FileLogger.getDefaultLogFilePath();
      expect(defaultPath).toContain("/custom/log/dir");
    });

    it("uses logDir from ForgeConfig when initialized", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "forge-filelogger-test-"));
      try {
        writeFileSync(
          join(tempDir, "forge.config.json"),
          JSON.stringify({
            logLevel: "info",
            workspaceProvider: "git-worktree",
            agents: {},
            defaultAgent: { model: { model: "gpt-4" } },
            logDir: "/custom-config-dir",
          }),
        );

        await ForgeConfig.create({ cwd: tempDir });

        const defaultPath = FileLogger.getDefaultLogFilePath();
        expect(defaultPath).toContain("/custom-config-dir");
      } finally {
        ForgeConfig.destroy();
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
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
});

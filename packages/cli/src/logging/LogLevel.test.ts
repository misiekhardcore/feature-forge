import { describe, expect, it } from "vitest";

import { LogLevel } from "../config";
import { Logger } from "./Logger";
import { DEFAULT_LOG_LEVEL } from "./LogLevel";

describe("LogLevel", () => {
  describe("enum", () => {
    it("has string values for each level", () => {
      expect(LogLevel.SILENT).toBe("silent");
      expect(LogLevel.ERROR).toBe("error");
      expect(LogLevel.WARN).toBe("warn");
      expect(LogLevel.INFO).toBe("info");
      expect(LogLevel.DEBUG).toBe("debug");
    });

    it("uses numeric precedence via Logger.LOG_LEVEL_ORDER for severity comparisons", () => {
      // Reset Logger to get a fresh instance with default level
      Logger.resetForTest();
      const logger = Logger.initialize();

      // ERROR is more severe than WARN → should log at WARN threshold
      expect(logger["shouldLog"](LogLevel.ERROR, LogLevel.WARN)).toBe(true);
      // WARN is more severe than INFO → should log at INFO threshold
      expect(logger["shouldLog"](LogLevel.WARN, LogLevel.INFO)).toBe(true);
      // DEBUG is below WARN threshold → should not log
      expect(logger["shouldLog"](LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      // INFO meets itself
      expect(logger["shouldLog"](LogLevel.INFO, LogLevel.INFO)).toBe(true);
    });
  });

  describe("DEFAULT_LOG_LEVEL", () => {
    it("is debug so all levels are written by default", () => {
      expect(DEFAULT_LOG_LEVEL).toBe(LogLevel.DEBUG);
    });
  });
});

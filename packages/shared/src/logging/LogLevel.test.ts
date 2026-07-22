import { describe, expect, it } from "vitest";

import { LogLevel } from "../config";
import { DEFAULT_LOG_LEVEL, levelSeverity, LOG_LEVEL_ORDER, shouldLog } from "./LogLevel";

describe("LogLevel", () => {
  describe("ordering", () => {
    it("ranks levels from most to least severe", () => {
      expect(LOG_LEVEL_ORDER).toEqual([
        LogLevel.SILENT,
        LogLevel.ERROR,
        LogLevel.WARN,
        LogLevel.INFO,
        LogLevel.DEBUG,
      ]);
    });

    it("assigns lower severity numbers to more severe levels", () => {
      expect(levelSeverity(LogLevel.ERROR)).toBe(1);
      expect(levelSeverity(LogLevel.WARN)).toBe(2);
      expect(levelSeverity(LogLevel.INFO)).toBe(3);
      expect(levelSeverity(LogLevel.DEBUG)).toBe(4);
    });
  });

  describe("shouldLog", () => {
    it("allows more severe levels through a less severe threshold", () => {
      expect(shouldLog(LogLevel.ERROR, LogLevel.INFO)).toBe(true);
      expect(shouldLog(LogLevel.WARN, LogLevel.DEBUG)).toBe(true);
    });

    it("blocks less severe levels below the threshold", () => {
      expect(shouldLog(LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      expect(shouldLog(LogLevel.INFO, LogLevel.ERROR)).toBe(false);
    });

    it("allows a level at its own threshold", () => {
      expect(shouldLog(LogLevel.ERROR, LogLevel.ERROR)).toBe(true);
      expect(shouldLog(LogLevel.DEBUG, LogLevel.DEBUG)).toBe(true);
    });
  });

  describe("DEFAULT_LOG_LEVEL", () => {
    it("is debug so all levels are written by default", () => {
      expect(DEFAULT_LOG_LEVEL).toBe(LogLevel.DEBUG);
    });
  });
});

import { LogLevel } from "@feature-forge/core/src/config";
import { describe, expect, it } from "vitest";

import { levelSeverity, LOG_LEVEL_ORDER, shouldLog } from "./LogLevel";

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

    it("returns -1 for unknown levels so they pass any threshold filter", () => {
      expect(levelSeverity("bogus" as LogLevel)).toBe(-1);
      expect(levelSeverity(undefined as unknown as LogLevel)).toBe(-1);
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
});

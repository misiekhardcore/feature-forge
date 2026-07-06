import { describe, expect, it } from "vitest";

import { DEFAULT_LOG_LEVEL, LogLevel } from "./LogLevel";

describe("LogLevel", () => {
  describe("enum", () => {
    it("orders levels from most to least severe", () => {
      expect(LogLevel.ERROR).toBe(0);
      expect(LogLevel.WARN).toBe(1);
      expect(LogLevel.INFO).toBe(2);
      expect(LogLevel.DEBUG).toBe(3);
    });

    it("allows direct comparison for severity thresholds", () => {
      expect(LogLevel.ERROR <= LogLevel.WARN).toBe(true);
      expect(LogLevel.WARN <= LogLevel.DEBUG).toBe(true);
      expect(LogLevel.DEBUG <= LogLevel.WARN).toBe(false);
    });
  });

  describe("DEFAULT_LOG_LEVEL", () => {
    it("is debug so all levels are written by default", () => {
      expect(DEFAULT_LOG_LEVEL).toBe(LogLevel.DEBUG);
    });
  });
});

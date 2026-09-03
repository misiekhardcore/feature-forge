import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger, logger, type LoggerDestination } from "./Logger";

/** Destination that records every write call for contract verification. */
class FakeDestination implements LoggerDestination {
  public calls: Array<{
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
  }> = [];
  public closed = false;

  write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    this.calls.push({ level, message, data });
  }

  close(): void {
    this.closed = true;
  }
}

function spyConsole(): {
  error: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  debug: ReturnType<typeof vi.spyOn>;
} {
  const spies = {
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };
  return spies;
}

describe("Logger", () => {
  describe("console fallback", () => {
    it("prints every severity to the console when no destination is attached", () => {
      const l = new Logger();
      l.setLevel(LogLevel.DEBUG);
      const spies = spyConsole();
      try {
        l.error("err msg", { key: "e" });
        l.warn("warn msg");
        l.info("info msg", { key: "i" });
        l.debug("debug msg");

        expect(spies.error).toHaveBeenCalledWith("err msg", { key: "e" });
        expect(spies.warn).toHaveBeenCalledWith("warn msg");
        expect(spies.info).toHaveBeenCalledWith("info msg", { key: "i" });
        expect(spies.debug).toHaveBeenCalledWith("debug msg");
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("omits undefined data from console calls", () => {
      const l = new Logger();
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        l.info("no data");
        expect(infoSpy).toHaveBeenCalledWith("no data");
        expect(infoSpy).not.toHaveBeenCalledWith("no data", undefined);
      } finally {
        infoSpy.mockRestore();
      }
    });

    it("suppresses entries below the configured threshold", () => {
      const l = new Logger();
      l.setLevel(LogLevel.ERROR);
      const spies = spyConsole();
      try {
        l.warn("warn msg");
        l.info("info msg");
        l.debug("debug msg");
        l.error("err msg");

        expect(spies.warn).not.toHaveBeenCalled();
        expect(spies.info).not.toHaveBeenCalled();
        expect(spies.debug).not.toHaveBeenCalled();
        expect(spies.error).toHaveBeenCalledWith("err msg");
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("suppresses everything at SILENT level", () => {
      const l = new Logger();
      l.setLevel(LogLevel.SILENT);
      const spies = spyConsole();
      try {
        l.error("e");
        l.warn("w");
        l.info("i");
        l.debug("d");

        expect(spies.error).not.toHaveBeenCalled();
        expect(spies.warn).not.toHaveBeenCalled();
        expect(spies.info).not.toHaveBeenCalled();
        expect(spies.debug).not.toHaveBeenCalled();
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("defaults to INFO: suppresses debug but prints warn", () => {
      const l = new Logger();
      expect(l.getLevel()).toBe(LogLevel.INFO);
      const spies = spyConsole();
      try {
        l.debug("d");
        l.warn("w");

        expect(spies.debug).not.toHaveBeenCalled();
        expect(spies.warn).toHaveBeenCalledWith("w");
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });
  });

  describe("level API", () => {
    it("defaults to INFO (config schema default)", () => {
      const l = new Logger();
      expect(l.getLevel()).toBe(LogLevel.INFO);
    });

    it("setLevel/getLevel round-trips the instance level", () => {
      const l = new Logger();
      expect(l.getLevel()).toBe(LogLevel.INFO);
      l.setLevel(LogLevel.DEBUG);
      expect(l.getLevel()).toBe(LogLevel.DEBUG);
      l.setLevel(LogLevel.SILENT);
      expect(l.getLevel()).toBe(LogLevel.SILENT);
    });

    it("configure updates the level and keeps it when omitted", () => {
      const l = new Logger();
      l.configure({ level: LogLevel.WARN });
      expect(l.getLevel()).toBe(LogLevel.WARN);
      l.configure({ destination: null });
      expect(l.getLevel()).toBe(LogLevel.WARN);
    });

    it("provides four severity methods", () => {
      const l = new Logger();
      expect(typeof l.error).toBe("function");
      expect(typeof l.warn).toBe("function");
      expect(typeof l.info).toBe("function");
      expect(typeof l.debug).toBe("function");
    });

    it("severity methods return void without throwing", () => {
      const l = new Logger();
      expect(() => l.error("test")).not.toThrow();
      expect(l.error("test")).toBeUndefined();
      expect(l.warn("test")).toBeUndefined();
      expect(l.info("test")).toBeUndefined();
      expect(l.debug("test")).toBeUndefined();
    });
  });

  describe("destination routing", () => {
    it("routes severity calls to the destination with the entry level", () => {
      const l = new Logger();
      l.setLevel(LogLevel.DEBUG);
      const destination = new FakeDestination();
      l.configure({ destination });
      const spies = spyConsole();
      try {
        l.error("error msg", { key: "e" });
        l.warn("warn msg", { key: "w" });
        l.info("info msg", { key: "i" });
        l.debug("debug msg", { key: "d" });

        expect(destination.calls).toEqual([
          { level: LogLevel.ERROR, message: "error msg", data: { key: "e" } },
          { level: LogLevel.WARN, message: "warn msg", data: { key: "w" } },
          { level: LogLevel.INFO, message: "info msg", data: { key: "i" } },
          { level: LogLevel.DEBUG, message: "debug msg", data: { key: "d" } },
        ]);
        // Nothing reaches the console while a destination is attached.
        expect(spies.error).not.toHaveBeenCalled();
        expect(spies.warn).not.toHaveBeenCalled();
        expect(spies.info).not.toHaveBeenCalled();
        expect(spies.debug).not.toHaveBeenCalled();
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("passes calls without optional data through to the destination", () => {
      const l = new Logger();
      const destination = new FakeDestination();
      l.configure({ destination });
      l.info("no data");
      expect(destination.calls).toEqual([{ level: LogLevel.INFO, message: "no data" }]);
    });

    it("filters before delegating to the destination", () => {
      const l = new Logger();
      const destination = new FakeDestination();
      l.configure({ level: LogLevel.WARN, destination });
      l.debug("d");
      l.info("i");
      l.warn("w");
      l.error("e");
      expect(destination.calls.map((call) => call.level)).toEqual([LogLevel.WARN, LogLevel.ERROR]);
    });

    it.each([null, undefined] as const)(
      "detaches the destination when configured with %s and returns to console",
      (detachValue) => {
        const l = new Logger();
        const destination = new FakeDestination();
        l.configure({ destination });

        // While attached, severity calls route to the destination only.
        const attachSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        try {
          l.info("routed to destination");
          expect(attachSpy).not.toHaveBeenCalled();
        } finally {
          attachSpy.mockRestore();
        }
        expect(destination.calls).toEqual([
          { level: LogLevel.INFO, message: "routed to destination" },
        ]);

        l.configure({ destination: detachValue });

        const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        try {
          l.info("back on console");
          expect(infoSpy).toHaveBeenCalledWith("back on console");
        } finally {
          infoSpy.mockRestore();
        }
        // The detached destination receives nothing further.
        expect(destination.calls).toEqual([
          { level: LogLevel.INFO, message: "routed to destination" },
        ]);
      },
    );

    it("level-only configure keeps the attached destination", () => {
      const l = new Logger();
      const destination = new FakeDestination();
      l.configure({ destination });

      l.configure({ level: LogLevel.ERROR });
      expect(l.getLevel()).toBe(LogLevel.ERROR);

      const spies = spyConsole();
      try {
        l.error("still routed");
        // The entry reached the destination, not the console.
        expect(destination.calls).toEqual([{ level: LogLevel.ERROR, message: "still routed" }]);
        expect(spies.error).not.toHaveBeenCalled();
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("configure({}) leaves both the level and the destination unchanged", () => {
      const l = new Logger();
      const destination = new FakeDestination();
      l.configure({ level: LogLevel.WARN, destination });

      l.configure({});

      expect(l.getLevel()).toBe(LogLevel.WARN);
      const spies = spyConsole();
      try {
        l.warn("still on destination");
        expect(destination.calls).toEqual([
          { level: LogLevel.WARN, message: "still on destination" },
        ]);
        expect(spies.warn).not.toHaveBeenCalled();
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("close() closes the attached destination", async () => {
      const l = new Logger();
      const destination = new FakeDestination();
      l.configure({ destination });
      await l.close();
      expect(destination.closed).toBe(true);
    });

    it("close() awaits a destination close that resolves asynchronously", async () => {
      const l = new Logger();
      let closeFinished = false;
      const destination: LoggerDestination = {
        write: () => {},
        close: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          closeFinished = true;
        },
      };
      l.configure({ destination });

      await l.close();
      // The flag is set only after the destination's own await completed;
      // close() must have awaited the destination close for it to be visible.
      expect(closeFinished).toBe(true);
    });

    it("close() propagates a rejecting destination close", async () => {
      const l = new Logger();
      const destination: LoggerDestination = {
        write: () => {},
        close: async () => {
          throw new Error("destination close failed");
        },
      };
      l.configure({ destination });

      await expect(l.close()).rejects.toThrow("destination close failed");
    });

    it("close() is a no-op when no destination is attached", async () => {
      const l = new Logger();
      await expect(l.close()).resolves.toBeUndefined();
    });
  });

  describe("module logger instance", () => {
    // Pin the shared module logger state so this describe stays robust to
    // future tests that configure the module instance.
    beforeEach(() => {
      logger.configure({ level: LogLevel.INFO, destination: null });
    });

    it("is a Logger with the default INFO level", () => {
      expect(logger).toBeInstanceOf(Logger);
      expect(logger.getLevel()).toBe(LogLevel.INFO);
    });

    it("prints warnings to the console by default", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        logger.warn("module warn");
        expect(warnSpy).toHaveBeenCalledWith("module warn");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

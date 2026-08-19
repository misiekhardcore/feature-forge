import { describe, expect, it } from "vitest";

import {
  ConfigError,
  InvalidConfigError,
  MissingConfigError,
  MissingConfigFileError,
} from "./ConfigError";

describe("ConfigError", () => {
  describe("constructor", () => {
    it("sets name to ConfigError", () => {
      const error = new ConfigError("test message");
      expect(error.name).toBe("ConfigError");
    });

    it("sets the message", () => {
      const error = new ConfigError("test message");
      expect(error.message).toBe("test message");
    });

    it("sets cause when provided", () => {
      const cause = new Error("root cause");
      const error = new ConfigError("wrapped", cause);
      expect(error.cause).toBe(cause);
    });

    it("leaves cause undefined when not provided", () => {
      const error = new ConfigError("no cause");
      expect(error.cause).toBeUndefined();
    });

    it("is an instance of Error", () => {
      const error = new ConfigError("test");
      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe("MissingConfigError", () => {
  describe("constructor", () => {
    it("sets name to MissingConfigError", () => {
      const error = new MissingConfigError("someKey");
      expect(error.name).toBe("MissingConfigError");
    });

    it("formats message with the missing key", () => {
      const error = new MissingConfigError("database.url");
      expect(error.message).toBe("Missing required configuration key: database.url");
    });

    it("is an instance of ConfigError", () => {
      const error = new MissingConfigError("key");
      expect(error).toBeInstanceOf(ConfigError);
    });

    it("is an instance of Error", () => {
      const error = new MissingConfigError("key");
      expect(error).toBeInstanceOf(Error);
    });

    it("propagates cause", () => {
      const cause = new Error("file not found");
      const error = new MissingConfigError("key", cause);
      expect(error.cause).toBe(cause);
    });
  });
});

describe("MissingConfigFileError", () => {
  describe("constructor", () => {
    it("sets name to MissingConfigFileError", () => {
      const error = new MissingConfigFileError("/path/to/config.json");
      expect(error.name).toBe("MissingConfigFileError");
    });

    it("formats message with the file path", () => {
      const error = new MissingConfigFileError("/home/user/forge.config.json");
      expect(error.message).toBe("Configuration file not found: /home/user/forge.config.json");
    });

    it("is an instance of ConfigError", () => {
      const error = new MissingConfigFileError("/path");
      expect(error).toBeInstanceOf(ConfigError);
    });

    it("is an instance of Error", () => {
      const error = new MissingConfigFileError("/path");
      expect(error).toBeInstanceOf(Error);
    });

    it("propagates cause", () => {
      const cause = new Error("ENOENT");
      const error = new MissingConfigFileError("/path", cause);
      expect(error.cause).toBe(cause);
    });
  });
});

describe("InvalidConfigError", () => {
  describe("constructor", () => {
    it("sets name to InvalidConfigError", () => {
      const error = new InvalidConfigError("port", "number", "abc");
      expect(error.name).toBe("InvalidConfigError");
    });

    it("formats message with key, expected, and actual", () => {
      const error = new InvalidConfigError("port", "number", "abc");
      expect(error.message).toBe('Invalid configuration for "port": expected number, got "abc"');
    });

    it("formats actual string values with quotes", () => {
      const error = new InvalidConfigError("mode", "silent|verbose", "debug");
      expect(error.message).toContain('"debug"');
    });

    it("formats non-string actual values without quotes", () => {
      const error = new InvalidConfigError("timeout", "number", 42);
      expect(error.message).toBe('Invalid configuration for "timeout": expected number, got 42');
    });

    it("formats null actual value", () => {
      const error = new InvalidConfigError("host", "string", null);
      expect(error.message).toBe('Invalid configuration for "host": expected string, got null');
    });

    it("formats object actual value", () => {
      const error = new InvalidConfigError("cfg", "object", { foo: 1 });
      expect(error.message).toBe(
        'Invalid configuration for "cfg": expected object, got [object Object]',
      );
    });

    it("is an instance of ConfigError", () => {
      const error = new InvalidConfigError("key", "type", "val");
      expect(error).toBeInstanceOf(ConfigError);
    });

    it("is an instance of Error", () => {
      const error = new InvalidConfigError("key", "type", "val");
      expect(error).toBeInstanceOf(Error);
    });

    it("propagates cause", () => {
      const cause = new Error("validation failed");
      const error = new InvalidConfigError("key", "string", 123, cause);
      expect(error.cause).toBe(cause);
    });
  });
});

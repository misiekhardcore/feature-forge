import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSupervisor } from "../agents";
import { Command } from "../commands/Command";
import { makeMockSpecManager } from "../test-utils";
import { CommandRegistry } from "./CommandRegistry";

class TestCommand extends Command {
  readonly name = "test:cmd";
  readonly description = "A test command";

  async handler(_args: string, _ctx: ExtensionCommandContext): Promise<void> {
    // no-op for testing
  }
}

class DuplicateCommand extends Command {
  readonly name = "dup";
  readonly description = "Duplicate";

  async handler(_args: string, _ctx: ExtensionCommandContext): Promise<void> {}
}

describe("CommandRegistry", () => {
  let mockPi: ExtensionAPI;
  let registry: CommandRegistry;

  beforeEach(() => {
    mockPi = {
      registerCommand: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;

    registry = new CommandRegistry({} as AgentSupervisor, mockPi, makeMockSpecManager());
  });

  describe("register", () => {
    it("registers a command and makes it retrievable", () => {
      const cmd = registry.register(TestCommand);
      expect(cmd).toBeInstanceOf(TestCommand);
      expect(cmd.name).toBe("test:cmd");
    });

    it("pi.registerCommand is called via registerAllWith", () => {
      registry.register(TestCommand);
      expect(mockPi.registerCommand).toHaveBeenCalledTimes(1);
      expect(mockPi.registerCommand).toHaveBeenCalledWith(
        "test:cmd",
        expect.objectContaining({ handler: expect.any(Function) }),
      );
    });

    it("throws when registering a command with a duplicate name", () => {
      registry.register(DuplicateCommand);
      expect(() => registry.register(DuplicateCommand)).toThrow("Command already registered: dup");
    });

    it("registered command is retrievable via get", () => {
      registry.register(TestCommand);
      expect(registry.get("test:cmd")).toBeInstanceOf(TestCommand);
    });

    it("pi.registerCommand handler executes the command", async () => {
      const cmd = registry.register(TestCommand);
      const executeSpy = vi.spyOn(cmd, "handler");

      const registerCall = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
      const handler = registerCall[1].handler;

      await handler("arg1", {});

      expect(executeSpy).toHaveBeenCalledWith("arg1", {});
    });
  });

  describe("registerAll", () => {
    it("registers multiple commands", () => {
      const cmds = registry.registerAll(TestCommand, DuplicateCommand);
      expect(cmds).toHaveLength(2);
      expect(registry.has("test:cmd")).toBe(true);
      expect(registry.has("dup")).toBe(true);
    });

    it("throws if any command has a duplicate name and stops registering", () => {
      registry.register(TestCommand);
      expect(() => registry.registerAll(TestCommand, DuplicateCommand)).toThrow(
        "Command already registered: test:cmd",
      );
    });
  });

  describe("inherited registry features", () => {
    it("size reflects registered commands", () => {
      expect(registry.size).toBe(0);
      registry.register(TestCommand);
      expect(registry.size).toBe(1);
    });

    it("unregister removes command and tracks correctly", () => {
      registry.register(TestCommand);
      expect(registry.size).toBe(1);
      expect(registry.unregister("test:cmd")).toBe(true);
      expect(registry.has("test:cmd")).toBe(false);
      expect(registry.size).toBe(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommandRegistry } from "./CommandRegistry";
import type { CommandDeps } from "./CommandDeps";
import { Command } from "../commands/Command";
import type { ExtensionCommandContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InMemoryAgentSupervisor } from "../agents/supervisors";
import { PiSubprocessAgentFactory } from "../agents/factories";

class TestCommand extends Command {
  readonly name = "test:cmd";
  readonly description = "A test command";

  constructor(private deps: CommandDeps) {
    super();
  }

  async execute(_args: string, _ctx: ExtensionCommandContext): Promise<void> {
    // no-op for testing
  }
}

class DuplicateCommand extends Command {
  readonly name = "dup";
  readonly description = "Duplicate";

  constructor(_deps: CommandDeps) {
    super();
  }

  async execute(_args: string, _ctx: ExtensionCommandContext): Promise<void> {}
}

describe("CommandRegistry", () => {
  let mockPi: ExtensionAPI;
  let supervisor: InMemoryAgentSupervisor;
  let deps: CommandDeps;
  let registry: CommandRegistry;

  beforeEach(() => {
    mockPi = {
      registerCommand: vi.fn(),
      sendMessage: vi.fn(),
    } as unknown as ExtensionAPI;

    const factory = new PiSubprocessAgentFactory();
    supervisor = new InMemoryAgentSupervisor(factory);

    deps = { supervisor, pi: mockPi };
    registry = new CommandRegistry(deps);
  });

  describe("register", () => {
    it("registers a command and calls pi.registerCommand", () => {
      const cmd = registry.register(TestCommand);
      expect(cmd).toBeInstanceOf(TestCommand);
      expect(cmd.name).toBe("test:cmd");
      expect(mockPi.registerCommand).toHaveBeenCalledTimes(1);
      expect(mockPi.registerCommand).toHaveBeenCalledWith("test:cmd", {
        description: "A test command",
        handler: expect.any(Function),
      });
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
      const executeSpy = vi.spyOn(cmd, "execute");

      const registerCall = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
      const handler = registerCall[1].handler;

      await handler("arg1", {} as ExtensionCommandContext);

      expect(executeSpy).toHaveBeenCalledWith("arg1", {});
    });
  });

  describe("registerAll", () => {
    it("registers multiple commands", () => {
      const cmds = registry.registerAll([TestCommand, DuplicateCommand]);
      expect(cmds).toHaveLength(2);
      expect(registry.has("test:cmd")).toBe(true);
      expect(registry.has("dup")).toBe(true);
    });

    it("throws if any command has a duplicate name and stops registering", () => {
      registry.register(TestCommand);
      expect(() => registry.registerAll([TestCommand, DuplicateCommand])).toThrow(
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

import { describe, expect, it, vi } from "vitest";

import { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
import { createShellStepExecutor, ShellStepExecutor } from "./ShellStepExecutor";

type MockExec = (
  command: string,
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

describe("ShellStepExecutor", () => {
  describe("type", () => {
    it("returns 'shell'", () => {
      const executor = new ShellStepExecutor();
      expect(executor.type).toBe("shell");
    });
  });

  describe("execute", () => {
    it("executes the command and stores stdout as the result", async () => {
      const customExec: MockExec = vi
        .fn()
        .mockResolvedValue({ stdout: "success output", stderr: "" });
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "echo hello",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "", "/tmp/ws");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("pr");
      expect(result!.raw).toBe("success output");
    });

    it("resolves template placeholders in the command", async () => {
      const customExec: MockExec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "gh pr create --title '{{task}}'",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "add auth", "");

      await executor.execute(instruction, context, async () => context);

      expect(customExec).toHaveBeenCalledWith(
        expect.stringContaining("add auth"),
        expect.anything(),
      );
    });

    it("resolves cwd template when set", async () => {
      const customExec: MockExec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "echo hello",
        cwd: "{{workspace}}/subdir",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "", "/tmp/ws");

      await executor.execute(instruction, context, async () => context);

      expect(customExec).toHaveBeenCalledWith("echo hello", {
        cwd: "/tmp/ws/subdir",
        timeout: 30000,
      });
    });

    it("uses context.workspace as cwd when no cwd is set", async () => {
      const customExec: MockExec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "echo hello",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "", "/tmp/ws");

      await executor.execute(instruction, context, async () => context);

      expect(customExec).toHaveBeenCalledWith("echo hello", { cwd: "/tmp/ws", timeout: 30000 });
    });

    it("captures stderr in the result", async () => {
      const customExec: MockExec = vi
        .fn()
        .mockResolvedValue({ stdout: "stdout", stderr: "some error" });
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "failing command",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("pr");
      expect(result!.raw).toContain("stdout");
      expect(result!.raw).toContain("some error");
    });

    it("stores error message on command failure", async () => {
      const customExec: MockExec = vi.fn().mockRejectedValue(new Error("command not found"));
      const executor = createShellStepExecutor(customExec);

      const instruction: FlowInstruction = {
        type: "shell",
        id: "pr",
        command: "nonexistent",
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("pr");
      expect(result!.raw).toContain("Command failed");
      expect(result!.raw).toContain("command not found");
    });
  });
});

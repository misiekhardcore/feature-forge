import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileRaw } = vi.hoisted(() => ({
  execFileRaw: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: Object.assign(execFileRaw, {
    [Symbol.for("nodejs.util.promisify.custom")]: (
      command: string,
      args?: string[] | null,
      options?: unknown,
    ) => {
      return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFileRaw(command, args, options, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(Object.assign(err, { stdout, stderr }));
          else resolve({ stdout, stderr });
        });
      });
    },
  }),
}));

import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { FlowContext } from "../FlowContext";
import type { ShellInstruction } from "../FlowInstruction";
import { ShellStepExecutor } from "./ShellStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function mockExecSuccess(stdout = "ok", stderr = ""): void {
  execFileRaw.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, stdout: string, stderr: string) => void,
    ) => {
      cb(null, stdout, stderr);
    },
  );
}

function mockExecFailure(message: string, stderr?: string): void {
  const err = Object.assign(new Error(message), { stderr: stderr ?? message });
  execFileRaw.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error, stdout: string, stderr: string) => void,
    ) => {
      cb(err, "", stderr ?? message);
    },
  );
}

// ── Tests ────────────────────────────────────────────────────

describe("ShellStepExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("runs a shell command in the resolved cwd", async () => {
      mockExecSuccess("pr created: https://github.com/...");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh1",
        command: "gh pr create --title 'fix'",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(execFileRaw).toHaveBeenCalledTimes(1);
      expect(execFileRaw.mock.calls[0][0]).toBe("/bin/sh");
      expect(execFileRaw.mock.calls[0][1]).toEqual(["-c", "gh pr create --title 'fix'"]);
      expect(execFileRaw.mock.calls[0][2].cwd).toBe("/tmp/ws");

      expect(result.results.get("sh1")!.parsed!.passed).toBe(true);
      expect(result.results.get("sh1")!.raw).toBe("pr created: https://github.com/...");
    });

    it("resolves placeholders in command and cwd", async () => {
      mockExecSuccess("done");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh2",
        command: "echo {{prompt}}",
        cwd: "{{workspace.ws}}",
      };
      const context = new FlowContext(
        new Map(),
        "hello world",
        new Map([["ws", new WorkspaceHandle("/tmp/ws", new Date())]]),
      );
      await executor.execute(instruction, context, vi.fn());

      expect(execFileRaw.mock.calls[0][1][1]).toBe("echo hello world");
      expect(execFileRaw.mock.calls[0][2].cwd).toBe("/tmp/ws");
    });

    it("includes stderr in output", async () => {
      mockExecSuccess("ok", "warning: something");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh3",
        command: "npm test",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("sh3")!.raw).toContain("warning: something");
    });

    it("returns a failure result when the command exits non-zero", async () => {
      mockExecFailure("Command failed", "error output");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh4",
        command: "exit 1",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("sh4")!.parsed!.passed).toBe(false);
      expect(result.results.get("sh4")!.raw).toContain("error output");
    });

    it("handles non-Error rejection from execFile", async () => {
      execFileRaw.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _opts: unknown,
          cb: (err: string, stdout: string, stderr: string) => void,
        ) => {
          cb("plain string error", "", "");
        },
      );
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh6",
        command: "bad",
        cwd: "/tmp",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("sh6")!.parsed!.passed).toBe(false);
    });

    it("falls back to error message when stderr is empty on failure", async () => {
      mockExecFailure("ECONNREFUSED");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh5",
        command: "curl http://localhost:12345",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("sh5")!.raw).toBe("stderr:\nECONNREFUSED");
    });
  });
});

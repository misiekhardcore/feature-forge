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
import type { GitInstruction } from "../FlowInstruction";
import { GitStepExecutor } from "./GitStepExecutor";

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

function mockExecFailure(message: string): void {
  execFileRaw.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error, stdout: string, stderr: string) => void,
    ) => {
      cb(new Error(message), "", message);
    },
  );
}

// ── Tests ────────────────────────────────────────────────────

describe("GitStepExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("runs add-and-commit in the resolved cwd with the default message", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git1",
        action: "add-and-commit",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      // Should have called git add -A and git commit.
      expect(execFileRaw).toHaveBeenCalledTimes(2);
      const addCall = execFileRaw.mock.calls[0];
      expect(addCall[0]).toBe("git");
      expect(addCall[1]).toEqual(["add", "-A"]);
      expect(addCall[2].cwd).toBe("/tmp/ws");

      const commitCall = execFileRaw.mock.calls[1];
      expect(commitCall[0]).toBe("git");
      expect(commitCall[1]).toEqual(["commit", "-m", "feature-forge: automated changes"]);

      expect(result.results.get("git1")!.parsed!.passed).toBe(true);
      expect(result.results.get("git1")!.raw).toContain("/tmp/ws");
    });

    it("uses a custom commit message when provided", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-custom",
        action: "add-and-commit",
        cwd: "/tmp/ws",
        message: "chore: bump version",
      };
      const context = new FlowContext(new Map(), "task");
      await executor.execute(instruction, context, vi.fn());

      const commitCall = execFileRaw.mock.calls[1];
      expect(commitCall[1]).toEqual(["commit", "-m", "chore: bump version"]);
    });

    it("resolves {{...}} placeholders inside the custom commit message", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-template",
        action: "add-and-commit",
        cwd: "/tmp/ws",
        message: "feat: {{task}}",
      };
      const context = new FlowContext(new Map(), "implement login");
      await executor.execute(instruction, context, vi.fn());

      const commitCall = execFileRaw.mock.calls[1];
      expect(commitCall[1]).toEqual(["commit", "-m", "feat: implement login"]);
    });

    it("runs push-current in the resolved cwd", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git2",
        action: "push-current",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(execFileRaw).toHaveBeenCalledTimes(1);
      expect(execFileRaw.mock.calls[0][0]).toBe("git");
      expect(execFileRaw.mock.calls[0][1]).toEqual(["push", "origin", "HEAD"]);

      expect(result.results.get("git2")!.parsed!.passed).toBe(true);
    });

    it("records captured stdout and stderr in raw on a successful push", async () => {
      mockExecSuccess("To github.com:repo.git\n", "remote: ok\n");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-push",
        action: "push-current",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("git-push")!.parsed!.passed).toBe(true);
      const raw = result.results.get("git-push")!.raw;
      expect(raw).toContain("To github.com:repo.git");
      expect(raw).toContain("remote: ok");
    });

    it("falls back to a structured raw when push output is empty", async () => {
      mockExecSuccess("", "");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-push-empty",
        action: "push-current",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("git-push-empty")!.parsed!.passed).toBe(true);
      expect(result.results.get("git-push-empty")!.raw).toContain("push-current");
      expect(result.results.get("git-push-empty")!.raw).toContain("/tmp/ws");
    });

    it("returns a failure result when the push command fails", async () => {
      mockExecFailure("fatal: could not read remote repository");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-push-fail",
        action: "push-current",
        cwd: "/bad/path",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("git-push-fail")!.parsed!.passed).toBe(false);
      expect(result.results.get("git-push-fail")!.raw).toContain("fatal:");
    });

    it("resolves placeholders in cwd", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git3",
        action: "add-and-commit",
        cwd: "{{workspace.ws}}",
      };
      const context = new FlowContext(
        new Map(),
        "task",
        new Map([["ws", new WorkspaceHandle("ws", "/resolved/ws", new Date())]]),
      );
      await executor.execute(instruction, context, vi.fn());

      expect(execFileRaw.mock.calls[0][2].cwd).toBe("/resolved/ws");
    });

    it("returns a failure result when git command fails", async () => {
      mockExecFailure("fatal: not a git repository");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git4",
        action: "add-and-commit",
        cwd: "/bad/path",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("git4")!.parsed!.passed).toBe(false);
      expect(result.results.get("git4")!.raw).toContain("fatal:");
    });
  });
});

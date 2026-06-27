import { describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { FlowContext } from "../FlowContext";
import type { GitInstruction } from "../FlowInstruction";
import { GitStepExecutor } from "./GitStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function mockExecSuccess(stdout = "ok", stderr = ""): void {
  execFileMock.mockImplementation(
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
  execFileMock.mockImplementation(
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
  describe("execute", () => {
    it("runs add-and-commit in the resolved cwd", async () => {
      mockExecSuccess();
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git1",
        action: "add-and-commit",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext(new Map(), "task");
      const result = await executor.execute(instruction, context);

      // Should have called git add -A and git commit.
      expect(execFileMock).toHaveBeenCalledTimes(2);
      const addCall = execFileMock.mock.calls[0];
      expect(addCall[0]).toBe("git");
      expect(addCall[1]).toEqual(["add", "-A"]);
      expect(addCall[2].cwd).toBe("/tmp/ws");

      const commitCall = execFileMock.mock.calls[1];
      expect(commitCall[0]).toBe("git");
      expect(commitCall[1]).toEqual(["commit", "-m", "feature-forge: automated changes"]);

      expect(result.results.get("git1")!.parsed!.passed).toBe(true);
      expect(result.results.get("git1")!.raw).toContain("/tmp/ws");
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
      const result = await executor.execute(instruction, context);

      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(execFileMock.mock.calls[0][0]).toBe("git");
      expect(execFileMock.mock.calls[0][1]).toEqual(["push", "origin", "HEAD"]);

      expect(result.results.get("git2")!.parsed!.passed).toBe(true);
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
      await executor.execute(instruction, context);

      expect(execFileMock.mock.calls[0][2].cwd).toBe("/resolved/ws");
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
      const result = await executor.execute(instruction, context);

      expect(result.results.get("git4")!.parsed!.passed).toBe(false);
      expect(result.results.get("git4")!.raw).toContain("fatal:");
    });
  });
});

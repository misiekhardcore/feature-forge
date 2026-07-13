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

import { makeMockTypedEventBus } from "../../test-utils";
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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
        message: "feat: {{prompt}}",
      };
      const context = new FlowContext({ results: new Map(), prompt: "implement login" });
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws", new WorkspaceHandle("/resolved/ws", new Date())]]),
      });
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(execFileRaw.mock.calls[0][2].cwd).toBe("/resolved/ws");
    });

    it("re-throws (hard failure) when add-and-commit fails, instead of returning passed:false", async () => {
      mockExecFailure("fatal: not a git repository");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git4",
        action: "add-and-commit",
        cwd: "/bad/path",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow("fatal: not a git repository");
    });

    it("already committed, nothing new to commit → succeeds (idempotent)", async () => {
      // git add succeeds, git commit fails with "nothing to commit", rev-parse succeeds
      execFileRaw
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: null, stdout: string, stderr: string) => void,
          ) => {
            cb(null, "", "");
          },
        )
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: Error, stdout: string, stderr: string) => void,
          ) => {
            cb(
              new Error("nothing to commit, working tree clean"),
              "",
              "nothing to commit, working tree clean",
            );
          },
        )
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: null, stdout: string, stderr: string) => void,
          ) => {
            cb(null, "abc123def456", "");
          },
        );

      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-idempotent",
        action: "add-and-commit",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(execFileRaw).toHaveBeenCalledTimes(3);
      expect(execFileRaw.mock.calls[2][1]).toEqual(["rev-parse", "--verify", "HEAD"]);
      expect(result.results.get("git-idempotent")!.parsed!.passed).toBe(true);
    });

    it("empty branch with nothing to commit → still throws", async () => {
      // git add succeeds, git commit fails with "nothing to commit", rev-parse fails
      execFileRaw
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: null, stdout: string, stderr: string) => void,
          ) => {
            cb(null, "", "");
          },
        )
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: Error, stdout: string, stderr: string) => void,
          ) => {
            cb(
              new Error("nothing to commit, working tree clean"),
              "",
              "nothing to commit, working tree clean",
            );
          },
        )
        .mockImplementationOnce(
          (
            _cmd: string,
            _args: string[],
            _opts: unknown,
            cb: (err: Error, stdout: string, stderr: string) => void,
          ) => {
            cb(new Error("fatal: Needed a single revision"), "", "fatal: Needed a single revision");
          },
        );

      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-empty",
        action: "add-and-commit",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow("nothing to commit");
    });

    it("emits git-start/git-done with correct phase and message for push-current", async () => {
      mockExecSuccess("pushed ok\n", "");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-events",
        action: "push-current",
        cwd: "/tmp/ws",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const eventBus = makeMockTypedEventBus();
      await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(eventBus.raw.emit).toHaveBeenCalledTimes(2);
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        1,
        "feature-forge:git-start",
        expect.objectContaining({
          phase: "git-start",
          message: expect.stringContaining("push-current") as string,
        }),
      );
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        2,
        "feature-forge:git-done",
        expect.objectContaining({ phase: "git-done" }),
      );
    });

    it("skips git-done when add-and-commit fails (exception propagates)", async () => {
      mockExecFailure("fatal: not a git repository");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-fail-events",
        action: "add-and-commit",
        cwd: "/bad/path",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const eventBus = makeMockTypedEventBus();

      await expect(executor.execute(instruction, context, vi.fn(), eventBus)).rejects.toThrow(
        "fatal: not a git repository",
      );

      // Only git-start was emitted.
      expect(eventBus.raw.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.raw.emit).toHaveBeenCalledWith("feature-forge:git-start", expect.anything());
    });

    describe("signal", () => {
      it("passes signal to execFile options for add-and-commit", async () => {
        mockExecSuccess();
        const executor = new GitStepExecutor();
        const controller = new AbortController();

        const instruction: GitInstruction = {
          type: "git",
          id: "git-sig",
          action: "add-and-commit",
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
          controller.signal,
        );

        expect(execFileRaw).toHaveBeenCalledTimes(2);
        expect(execFileRaw.mock.calls[0][2].signal).toBe(controller.signal);
        expect(execFileRaw.mock.calls[1][2].signal).toBe(controller.signal);
      });

      it("passes signal to execFile options for push-current", async () => {
        mockExecSuccess();
        const executor = new GitStepExecutor();
        const controller = new AbortController();

        const instruction: GitInstruction = {
          type: "git",
          id: "git-sig-push",
          action: "push-current",
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
          controller.signal,
        );

        expect(execFileRaw).toHaveBeenCalledTimes(1);
        expect(execFileRaw.mock.calls[0][2].signal).toBe(controller.signal);
      });
    });

    it("emits git-done when push-current fails (soft failure still resolves)", async () => {
      mockExecFailure("fatal: could not read from remote repository");
      const executor = new GitStepExecutor();

      const instruction: GitInstruction = {
        type: "git",
        id: "git-push-soft-fail",
        action: "push-current",
        cwd: "/bad/path",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const eventBus = makeMockTypedEventBus();

      const result = await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(result.results.get("git-push-soft-fail")!.parsed!.passed).toBe(false);

      expect(eventBus.raw.emit).toHaveBeenCalledTimes(2);
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        1,
        "feature-forge:git-start",
        expect.anything(),
      );
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        2,
        "feature-forge:git-done",
        expect.objectContaining({
          message: expect.stringContaining("failed") as string,
        }),
      );
    });
  });
});

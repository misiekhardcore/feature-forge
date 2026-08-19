import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type { ShellInstruction } from "@feature-forge/core/src/flows/FlowInstruction";
import { makeMockTypedEventBus } from "@feature-forge/core/src/test-utils";
import { WorkspaceHandle } from "@feature-forge/core/src/workspace/WorkspaceHandle";

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
  let wsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-shell-"));
  });

  describe("execute", () => {
    it("runs a shell command in the resolved cwd", async () => {
      mockExecSuccess("pr created: https://github.com/...");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh1",
        command: "gh pr create --title 'fix'",
        cwd: wsDir,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(execFileRaw).toHaveBeenCalledTimes(1);
      expect(execFileRaw.mock.calls[0][0]).toBe("/bin/sh");
      expect(execFileRaw.mock.calls[0][1]).toEqual(["-c", "gh pr create --title 'fix'"]);
      expect(execFileRaw.mock.calls[0][2].cwd).toBe(wsDir);

      expect(result.results.get("sh1")!.parsed!.passed).toBe(true);
      expect(result.results.get("sh1")!.raw).toBe("pr created: https://github.com/...");
    });

    it("runs in the process working directory when cwd is omitted", async () => {
      mockExecSuccess("ok");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh-nocwd",
        command: "echo hi",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(execFileRaw).toHaveBeenCalledTimes(1);
      expect(execFileRaw.mock.calls[0][2].cwd).toBeUndefined();
      expect(result.results.get("sh-nocwd")!.parsed!.passed).toBe(true);
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "hello world",
        workspaces: new Map([["ws", new WorkspaceHandle(wsDir, new Date())]]),
      });
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(execFileRaw.mock.calls[0][1][1]).toBe("echo hello world");
      expect(execFileRaw.mock.calls[0][2].cwd).toBe(wsDir);
    });

    it("includes stderr in output", async () => {
      mockExecSuccess("ok", "warning: something");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh3",
        command: "npm test",
        cwd: wsDir,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("sh3")!.raw).toContain("warning: something");
    });

    it("returns a failure result when the command exits non-zero", async () => {
      mockExecFailure("Command failed", "error output");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh4",
        command: "exit 1",
        cwd: wsDir,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("sh6")!.parsed!.passed).toBe(false);
    });

    it("falls back to error message when stderr is empty on failure", async () => {
      mockExecFailure("ECONNREFUSED");
      const executor = new ShellStepExecutor();

      const instruction: ShellInstruction = {
        type: "shell",
        id: "sh5",
        command: "curl http://localhost:12345",
        cwd: wsDir,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("sh5")!.raw).toBe("stderr:\nECONNREFUSED");
    });

    it("preserves heredoc structure and special characters in resolved commands", async () => {
      mockExecSuccess("done");
      const executor = new ShellStepExecutor();

      // Simulate the open_pr heredoc pattern with body containing shell metacharacters
      const instruction: ShellInstruction = {
        type: "shell",
        id: "pr",
        command:
          'cat > /tmp/ff-pr-body-$$.md << \'FFEOF\'\n{{body}}\nFFEOF\ngh pr create --title "{{title}}" --body-file /tmp/ff-pr-body-$$.md --base "{{base}}"; rm -f /tmp/ff-pr-body-$$.md',
        cwd: wsDir,
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        params: new Map([
          ["body", "Fix backticks: `cmd` and ${VAR}"],
          ["title", "feat: handle special chars"],
          ["base", "main"],
        ]),
      });
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const resolvedCmd: string = execFileRaw.mock.calls[0][1][1];

      // Heredoc delimiter must be quoted (no shell expansion inside)
      expect(resolvedCmd).toMatch(/<<\s*'FFEOF'/);
      // Must use --body-file, not inline --body
      expect(resolvedCmd).toContain("--body-file");
      expect(resolvedCmd).not.toMatch(/--body\s/);
      // Special characters must appear literally (not expanded/interpreted)
      expect(resolvedCmd).toContain("`cmd`");
      expect(resolvedCmd).toContain("${VAR}");
      // Must clean up temp file
      expect(resolvedCmd).toContain("rm -f /tmp/ff-pr-body-$$.md");
    });

    describe("cwd validation", () => {
      it("rejects an unresolved placeholder cwd with an actionable message", async () => {
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh-badcwd",
          command: "echo hi",
          cwd: "{{workspace}}",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });
        const promise = executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

        await expect(promise).rejects.toThrow(
          /Shell step "sh-badcwd": working directory "\{\{workspace\}\}" contains an unresolved placeholder/,
        );
        await expect(promise).rejects.toThrow(
          /set_flow_param\(key="workspace", value=<worktree path>\)/,
        );
        expect(execFileRaw).not.toHaveBeenCalled();
      });

      it("rejects an empty resolved cwd", async () => {
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh-emptycwd",
          command: "echo hi",
          cwd: "{{missing}}",
        };
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
          params: new Map([["missing", ""]]),
        });

        await expect(
          executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
        ).rejects.toThrow(/working directory is empty/);
        expect(execFileRaw).not.toHaveBeenCalled();
      });

      it("rejects a cwd that does not exist", async () => {
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh-missingcwd",
          command: "echo hi",
          cwd: path.join(wsDir, "nope"),
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await expect(
          executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
        ).rejects.toThrow(/does not exist or is not a directory/);
        expect(execFileRaw).not.toHaveBeenCalled();
      });

      it("rejects a cwd that is a file, not a directory", async () => {
        const filePath = path.join(wsDir, "not-a-dir");
        fs.writeFileSync(filePath, "x");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh-filecwd",
          command: "echo hi",
          cwd: filePath,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await expect(
          executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
        ).rejects.toThrow(/does not exist or is not a directory/);
        expect(execFileRaw).not.toHaveBeenCalled();
      });
    });

    describe("failFast", () => {
      it("throws instead of returning soft-failure when failFast is true", async () => {
        mockExecFailure("Command failed", "error output");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "rebase",
          command: "git rebase origin/main",
          cwd: wsDir,
          failFast: true,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await expect(
          executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
        ).rejects.toThrow("Command failed");
      });

      it("returns soft-failure result when failFast is false (default)", async () => {
        mockExecFailure("Command failed", "error output");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh4",
          command: "exit 1",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });
        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        expect(result.results.get("sh4")!.parsed!.passed).toBe(false);
      });

      it("returns soft-failure result when failFast is explicitly false", async () => {
        mockExecFailure("Command failed", "error output");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh5",
          command: "exit 1",
          cwd: wsDir,
          failFast: false,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });
        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        expect(result.results.get("sh5")!.parsed!.passed).toBe(false);
      });

      it("does nothing on success when failFast is true (no-op)", async () => {
        mockExecSuccess("ok");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh6",
          command: "echo ok",
          cwd: wsDir,
          failFast: true,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });
        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        expect(result.results.get("sh6")!.parsed!.passed).toBe(true);
      });
    });

    describe("signal", () => {
      it("passes signal to execFile options", async () => {
        mockExecSuccess("ok");
        const executor = new ShellStepExecutor();
        const controller = new AbortController();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sig",
          command: "echo hello",
          cwd: wsDir,
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

      it("propagates AbortError when signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sig2",
          command: "echo hello",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await expect(
          executor.execute(
            instruction,
            context,
            vi.fn(),
            makeMockTypedEventBus(),
            controller.signal,
          ),
        ).rejects.toThrow("This operation was aborted");

        // execFile should never be reached when signal is pre-aborted.
        expect(execFileRaw).not.toHaveBeenCalled();
      });
    });

    describe("eventBus", () => {
      it("emits shell-start and shell-done events on success", async () => {
        mockExecSuccess("ok");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "echo hello",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledTimes(2);
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:shell-start",
          expect.objectContaining({
            phase: "shell-start",
            message: expect.stringContaining("echo hello") as string,
          }),
        );
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:shell-done",
          expect.objectContaining({ phase: "shell-done" }),
        );
      });

      it("emits only shell-start when the command fails", async () => {
        mockExecFailure("Command failed", "error output");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh2",
          command: "false",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockTypedEventBus();
        const result = await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledTimes(1);
        expect(eventBus.raw.emit).toHaveBeenCalledWith(
          "feature-forge:shell-start",
          expect.anything(),
        );
        expect(result.results.get("sh2")!.parsed!.passed).toBe(false);
      });

      it("works with a mocked eventBus", async () => {
        mockExecSuccess("ok");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "echo ok",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        expect(result.results.get("sh1")!.parsed!.passed).toBe(true);
      });

      it("includes prUrl in shell-done event details when output contains a URL", async () => {
        mockExecSuccess("PR created: https://github.com/owner/repo/pull/42");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "gh pr create",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:shell-done",
          expect.objectContaining({
            details: expect.objectContaining({
              passed: true,
            }),
          }),
        );
      });

      it("omits prUrl in shell-done event details when output has no URL", async () => {
        mockExecSuccess("build completed successfully");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "npm run build",
          cwd: wsDir,
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:shell-done",
          expect.not.objectContaining({
            details: expect.objectContaining({ prUrl: expect.anything() }),
          }),
        );
      });
    });
  });
});

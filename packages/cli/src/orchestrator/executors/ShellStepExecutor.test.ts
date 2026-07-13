import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMutableState } from "../progress/AccumulatedState";
import type { DisplayContribution, StatusContribution } from "../progress/DisplayContribution";
import { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";

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

import { makeMockEventBus } from "../../test-utils";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { FlowContext } from "../FlowContext";
import type { ShellInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "hello world",
        workspaces: new Map([["ws", new WorkspaceHandle("/tmp/ws", new Date())]]),
      });
      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("sh5")!.raw).toBe("stderr:\nECONNREFUSED");
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
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockEventBus(),
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
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        await expect(
          executor.execute(instruction, context, vi.fn(), makeMockEventBus(), controller.signal),
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
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenCalledTimes(2);
        expect(eventBus.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:shell-start",
          expect.objectContaining({
            phase: "shell-start",
            message: expect.stringContaining("echo hello") as string,
          }),
        );
        expect(eventBus.emit).toHaveBeenNthCalledWith(
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
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockEventBus();
        const result = await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).toHaveBeenCalledWith("feature-forge:shell-start", expect.anything());
        expect(result.results.get("sh2")!.parsed!.passed).toBe(false);
      });

      it("works with a mocked eventBus", async () => {
        mockExecSuccess("ok");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "echo ok",
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

        expect(result.results.get("sh1")!.parsed!.passed).toBe(true);
      });

      it("includes prUrl in shell-done event details when output contains a URL", async () => {
        mockExecSuccess("PR created: https://github.com/owner/repo/pull/42");
        const executor = new ShellStepExecutor();

        const instruction: ShellInstruction = {
          type: "shell",
          id: "sh1",
          command: "gh pr create",
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:shell-done",
          expect.objectContaining({
            details: expect.objectContaining({
              prUrl: "https://github.com/owner/repo/pull/42",
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
          cwd: "/tmp/ws",
        };
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:shell-done",
          expect.not.objectContaining({
            details: expect.objectContaining({ prUrl: expect.anything() }),
          }),
        );
      });
    });

    describe("getDisplayContribution", () => {
      function getStatus(
        executor: ShellStepExecutor,
        event: RoutineProgressEvent,
      ): StatusContribution | undefined {
        return executor.getDisplayContribution(event) as StatusContribution | undefined;
      }

      it("returns contribution with prUrl from shell-done event", () => {
        const executor = new ShellStepExecutor();

        const contribution = getStatus(executor, {
          phase: "shell-done",
          message: "Shell completed",
          details: { prUrl: "https://github.com/owner/repo/pull/42" },
        });

        expect(contribution).toBeDefined();
        expect(contribution!.phase).toBe("shell-done");
        expect(contribution!.message).toBe("https://github.com/owner/repo/pull/42");
      });

      it("returns undefined for shell-done events without prUrl", () => {
        const executor = new ShellStepExecutor();

        const event: RoutineProgressEvent = {
          phase: "shell-done",
          message: "Shell completed",
          details: {},
        };

        expect(executor.getDisplayContribution(event)).toBeUndefined();
      });

      it("returns undefined for non-shell-done events", () => {
        const executor = new ShellStepExecutor();

        const event: RoutineProgressEvent = {
          phase: "shell-start",
          message: "Shell started",
          details: {},
        };

        expect(executor.getDisplayContribution(event)).toBeUndefined();
      });
    });
  });

  describe("registerDisplayHandler", () => {
    it("registers a 'status' handler that does not modify accumulated state", () => {
      const executor = new ShellStepExecutor();
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      expect(registry.has("status")).toBe(true);

      const contributions: DisplayContribution[] = [
        { type: "status", phase: "shell-done", message: "Done" },
      ];

      const state = createMutableState();
      registry.apply(state, contributions);

      expect(state.agentMap.size).toBe(0);
      expect(state.workspacePath).toBeUndefined();
      expect(state.continueWhile).toBeUndefined();
    });
  });
});

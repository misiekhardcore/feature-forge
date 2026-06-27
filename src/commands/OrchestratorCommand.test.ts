import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockCtx, makeMockPi, makeMockSpecManager } from "../test-utils";
import { OrchestratorCommand } from "./OrchestratorCommand";

const { mockReadFile } = vi.hoisted(() => {
  const mockReadFile = vi.fn();
  return { mockReadFile };
});

vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
  readdir: vi.fn().mockResolvedValue([]),
  access: vi.fn().mockResolvedValue(undefined),
}));

describe("OrchestratorCommand", () => {
  const flowsDir = "/tmp/test-flows";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and description", () => {
    const pi = makeMockPi();
    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    expect(cmd.name).toBe("implement");
    expect(cmd.description).toContain("implement");
  });

  it("notifies on empty args", async () => {
    const pi = makeMockPi();
    const ctx = makeMockCtx();
    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    await cmd.handler("  ", ctx as never);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Usage:"), "error");
  });

  it("loads flow, reads orchestrator prompt, and sends to session", async () => {
    const pi = makeMockPi();
    (pi as unknown as Record<string, unknown>).sendUserMessage = vi
      .fn()
      .mockResolvedValue(undefined);
    const ctx = makeMockCtx();

    mockReadFile.mockImplementation(async (filepath: string) => {
      if (filepath.endsWith("flow.json")) {
        return JSON.stringify({
          name: "implement",
          command: "/implement",
          orchestrator: { prompt: "orchestrator.md" },
          routines: {},
        });
      }
      if (filepath.endsWith("orchestrator.md")) {
        return "# Implement\n\nTask: {{task}}";
      }
      throw new Error(`Unexpected file: ${filepath}`);
    });

    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    await cmd.handler("add auth", ctx as never);

    expect((pi as unknown as Record<string, unknown>).sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("add auth"),
    );
  });

  it("notifies on flow load error", async () => {
    const pi = makeMockPi();
    const ctx = makeMockCtx();

    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    await cmd.handler("add auth", ctx as never);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load flow"),
      "error",
    );
  });

  it("notifies on prompt file read error", async () => {
    const pi = makeMockPi();
    const ctx = makeMockCtx();

    // First call (flow.json) succeeds, second call (orchestrator.md) fails
    let callCount = 0;
    mockReadFile.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          name: "implement",
          command: "/implement",
          orchestrator: { prompt: "orchestrator.md" },
          routines: {},
        });
      }
      throw new Error("ENOENT: no such file");
    });

    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    await cmd.handler("add auth", ctx as never);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed to read orchestrator prompt"),
      "error",
    );
  });

  it("notifies active tools when declared in flow definition", async () => {
    const pi = makeMockPi();
    (pi as unknown as Record<string, unknown>).sendUserMessage = vi
      .fn()
      .mockResolvedValue(undefined);
    const ctx = makeMockCtx();

    mockReadFile.mockImplementation(async (filepath: string) => {
      if (filepath.endsWith("flow.json")) {
        return JSON.stringify({
          name: "implement",
          command: "/implement",
          orchestrator: {
            prompt: "orchestrator.md",
            activeTools: ["run_build_loop", "bash"],
          },
          routines: {
            run_build_loop: { params: [], steps: [] },
            bash: { params: [], steps: [] },
          },
        });
      }
      if (filepath.endsWith("orchestrator.md")) {
        return "# Implement\n\nTask: {{task}}";
      }
      throw new Error(`Unexpected file: ${filepath}`);
    });

    const cmd = new OrchestratorCommand(
      {} as never,
      pi as never,
      makeMockSpecManager() as never,
      "implement",
      flowsDir,
    );

    await cmd.handler("add auth", ctx as never);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("run_build_loop, bash"),
      "info",
    );
  });
});

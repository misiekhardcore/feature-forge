import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockCtx, makeMockPi } from "../test-utils";
import { ForgeInitCommand } from "./ForgeInitCommand";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

type MockUi = {
  confirm: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

const pi = makeMockPi();

describe("ForgeInitCommand", () => {
  let cmd: ForgeInitCommand;
  let ctx: ExtensionCommandContext & { ui: MockUi };

  beforeEach(() => {
    // The handler uses promisify(execFile), so the mock must invoke the
    // trailing callback to let the promisified promise settle.
    execFileMock.mockReset();
    execFileMock.mockImplementation(
      (_file: string, _args: string[], cb?: (err: Error | null) => void) => {
        cb?.(null);
      },
    );
    cmd = new ForgeInitCommand({ pi });
    ctx = makeMockCtx() as ExtensionCommandContext & { ui: MockUi };
  });

  /** Extract the args array passed to execFile("node", args, cb). */
  function executedArgs(): string[] {
    expect(execFileMock).toHaveBeenCalledTimes(1);
    return execFileMock.mock.calls[0][1] as string[];
  }

  it("has name 'forge:init'", () => {
    expect(cmd.name).toBe("forge:init");
  });

  it("asks for installation scope and scaffolds globally when global is chosen", async () => {
    ctx.ui.select.mockResolvedValue(
      "global — ~/.forge shared across projects (logs and worktrees stay project-local)",
    );

    await cmd.handler("", ctx);

    expect(ctx.ui.select).toHaveBeenCalledTimes(1);
    expect(ctx.ui.select).toHaveBeenCalledWith(
      "Forge: Init — where should agents, flows, and skills be stored?",
      [
        "project — .forge/ inside this project",
        "global — ~/.forge shared across projects (logs and worktrees stay project-local)",
      ],
    );
    expect(ctx.ui.confirm).not.toHaveBeenCalled();
    expect(executedArgs()).toEqual([
      expect.stringMatching(/forge-setup\.js$/),
      "--global",
      "--yes",
      "--cwd",
      process.cwd(),
    ]);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Feature Forge initialized successfully — restart pi to load the scaffolded agents and flows",
      "info",
    );
  });

  it("asks local prompts and omits --global when project scope is chosen", async () => {
    ctx.ui.select.mockResolvedValue("project — .forge/ inside this project");
    ctx.ui.confirm
      .mockResolvedValueOnce(true) // scaffold config
      .mockResolvedValueOnce(true); // gitignore

    await cmd.handler("", ctx);

    expect(ctx.ui.confirm).toHaveBeenCalledTimes(2);
    expect(executedArgs()).toEqual([
      expect.stringMatching(/forge-setup\.js$/),
      "--yes",
      "--cwd",
      process.cwd(),
    ]);
  });

  it("passes --no-config and --no-gitignore when declined in local mode", async () => {
    ctx.ui.select.mockResolvedValue("project — .forge/ inside this project");
    ctx.ui.confirm.mockResolvedValue(false);

    await cmd.handler("", ctx);

    expect(executedArgs()).toEqual([
      expect.stringMatching(/forge-setup\.js$/),
      "--no-config",
      "--no-gitignore",
      "--yes",
      "--cwd",
      process.cwd(),
    ]);
  });

  it("cancels without running setup when the scope dialog is dismissed", async () => {
    ctx.ui.select.mockResolvedValue(undefined);

    await cmd.handler("", ctx);

    expect(execFileMock).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Forge init cancelled", "info");
  });

  it("notifies error when setup fails", async () => {
    ctx.ui.select.mockResolvedValue(
      "global — ~/.forge shared across projects (logs and worktrees stay project-local)",
    );
    execFileMock.mockImplementation(
      (_file: string, _args: string[], cb?: (err: Error | null) => void) => {
        cb?.(new Error("boom"));
      },
    );

    await cmd.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("Setup failed: boom", "error");
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      "Feature Forge initialized successfully — restart pi to load the scaffolded agents and flows",
      "info",
    );
  });
});

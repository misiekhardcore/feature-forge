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
    cmd = new ForgeInitCommand(undefined as never, pi);
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

  it("runs forge-setup with all defaults when every prompt is accepted", async () => {
    ctx.ui.confirm.mockResolvedValue(true);

    await cmd.handler("", ctx);

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

  it("passes --no-config, --no-gitignore, and --global when declined except global", async () => {
    ctx.ui.confirm
      .mockResolvedValueOnce(false) // scaffold config
      .mockResolvedValueOnce(false) // gitignore
      .mockResolvedValueOnce(true); // global

    await cmd.handler("", ctx);

    expect(executedArgs()).toEqual([
      expect.stringMatching(/forge-setup\.js$/),
      "--no-config",
      "--no-gitignore",
      "--global",
      "--yes",
      "--cwd",
      process.cwd(),
    ]);
  });

  it("passes --global when the global prompt is accepted", async () => {
    ctx.ui.confirm.mockResolvedValue(true);

    await cmd.handler("", ctx);

    expect(executedArgs()).toContain("--global");
    expect(ctx.ui.confirm).toHaveBeenCalledWith(
      "Forge: Init",
      "Install globally in ~/.forge (shared across projects)?",
    );
  });

  it("omits --global when the global prompt is declined", async () => {
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

  it("notifies error when setup fails", async () => {
    ctx.ui.confirm.mockResolvedValue(true);
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

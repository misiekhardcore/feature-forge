import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ForgeConfig, Logger } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import featureForgeExtension from "./index";
import { makeMockPi } from "./test-utils";

describe("featureForgeExtension degraded mode", () => {
  let tempDir: string;
  let originalParentSocket: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-degraded-"));
    originalParentSocket = process.env.FORGE_PARENT_SOCKET;
    delete process.env.FORGE_PARENT_SOCKET;
    // Isolate HOME so a real global ~/.forge on the host cannot make the
    // extension think the forge dir is already scaffolded (degraded mode).
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tempDir, "home");
  });

  afterEach(() => {
    if (originalParentSocket !== undefined) {
      process.env.FORGE_PARENT_SOCKET = originalParentSocket;
    } else {
      delete process.env.FORGE_PARENT_SOCKET;
    }
    process.env.HOME = originalHome;
    ForgeConfig.destroy();
    Logger.resetForTest();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers only /forge:init when the forge directory is not scaffolded", async () => {
    const pi = makeMockPi();
    ForgeConfig.destroy();
    await ForgeConfig.create({ cwd: tempDir });
    await featureForgeExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "forge:init",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("does not register session_start notice for child agent sessions", async () => {
    process.env.FORGE_PARENT_SOCKET = "/tmp/mock-socket";
    const pi = makeMockPi();
    ForgeConfig.destroy();
    await ForgeConfig.create({ cwd: tempDir });
    await featureForgeExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("registers only /forge:init when configuration fails to load", async () => {
    const pi = makeMockPi();
    const createSpy = vi.spyOn(ForgeConfig, "create").mockRejectedValueOnce(new Error("boom"));

    try {
      await featureForgeExtension(pi);
    } finally {
      createSpy.mockRestore();
    }

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "forge:init",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });
});

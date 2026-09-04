import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ForgeConfigLoader, ForgeConfigPaths, logger, LogLevel } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import featureForgeExtension from "./index";
import { makeMockPi } from "./test-utils";

describe("featureForgeExtension degraded mode", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalParentSocket: string | undefined;
  let originalHome: string | undefined;
  let packagedAgentsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-degraded-"));
    originalCwd = process.cwd();
    // Point the extension's config load (it reads process.cwd()) at an empty
    // temp project: no config file, and a .forge dir that has not been
    // scaffolded. The packaged default layer (dev layout probes resolve the
    // repo's core/src markers) would otherwise fill the gap, so stub it
    // absent too: degraded mode now means no agent specs in ANY layer.
    process.chdir(tempDir);
    originalParentSocket = process.env.FORGE_PARENT_SOCKET;
    delete process.env.FORGE_PARENT_SOCKET;
    // Isolate HOME so a real global ~/.forge on the host cannot make the
    // extension think the forge dir is already scaffolded (degraded mode).
    originalHome = process.env.HOME;
    process.env.HOME = path.join(tempDir, "home");
    packagedAgentsSpy = vi
      .spyOn(ForgeConfigPaths, "resolvePackagedAgentsDir")
      .mockReturnValue(undefined);
  });

  afterEach(() => {
    packagedAgentsSpy.mockRestore();
    process.chdir(originalCwd);
    if (originalParentSocket !== undefined) {
      process.env.FORGE_PARENT_SOCKET = originalParentSocket;
    } else {
      delete process.env.FORGE_PARENT_SOCKET;
    }
    process.env.HOME = originalHome;
    // Restore the module logger to console defaults via the
    // logger.configure seam (level + destination are instance state on the
    // shared Logger). Logging init (FileLogger.install) runs before the
    // degraded return for the unscaffolded-forge path, so the tests above
    // can leave a file destination attached to the module logger; detach
    // it and pin the INFO level so a level/destination configured in this
    // file cannot leak into later tests.
    logger.configure({ level: LogLevel.INFO, destination: null });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("registers only /forge:init when no agent specs exist in any layer", async () => {
    const pi = makeMockPi();
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
    await featureForgeExtension(pi);

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.on).not.toHaveBeenCalled();
  });

  it("registers only /forge:init when configuration fails to load", async () => {
    const pi = makeMockPi();
    const loadSpy = vi.spyOn(ForgeConfigLoader, "load").mockRejectedValueOnce(new Error("boom"));

    try {
      await featureForgeExtension(pi);
    } finally {
      loadSpy.mockRestore();
    }

    expect(pi.registerCommand).toHaveBeenCalledTimes(1);
    expect(pi.registerCommand).toHaveBeenCalledWith(
      "forge:init",
      expect.objectContaining({ description: expect.any(String) }),
    );
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });
});

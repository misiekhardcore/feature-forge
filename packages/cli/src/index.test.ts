import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ForgeConfig } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import featureForgeExtension from "./index";
import { makeMockPi } from "./test-utils";

describe("featureForgeExtension degraded mode", () => {
  let tempDir: string;
  let originalParentSocket: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-degraded-"));
    originalParentSocket = process.env.FORGE_PARENT_SOCKET;
    delete process.env.FORGE_PARENT_SOCKET;
  });

  afterEach(() => {
    if (originalParentSocket !== undefined) {
      process.env.FORGE_PARENT_SOCKET = originalParentSocket;
    } else {
      delete process.env.FORGE_PARENT_SOCKET;
    }
    ForgeConfig.destroy();
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
});

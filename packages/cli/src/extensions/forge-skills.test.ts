import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ForgeConfig } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateForgeSkills } from "./forge-skills";

describe("activateForgeSkills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-ext-"));
    // test-setup.ts pre-initializes the singleton without a cwd; reset it so
    // create() below binds to the temp project root.
    ForgeConfig.destroy();
  });

  afterEach(() => {
    ForgeConfig.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("contributes only the forge directory skills", async () => {
    fs.mkdirSync(path.join(tempDir, ".forge", "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".forge", "skills", "demo", "SKILL.md"),
      "---\nname: demo\n---\n",
    );
    await ForgeConfig.create({ cwd: tempDir });

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi);

    const result = (await pi.getHandler("resources_discover")!()) as {
      skillPaths?: string[];
    };
    expect(result).toEqual({ skillPaths: [path.join(tempDir, ".forge", "skills")] });
  });

  it("contributes nothing when the forge skills directory is missing", async () => {
    await ForgeConfig.create({ cwd: tempDir });

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi);

    const result = await pi.getHandler("resources_discover")!();
    expect(result).toEqual({});
  });

  it("does not fall back to bundled skill directories", async () => {
    await ForgeConfig.create({ cwd: tempDir });

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi);

    const result = (await pi.getHandler("resources_discover")!()) as {
      skillPaths?: string[];
    };
    expect(result.skillPaths ?? []).toEqual([]);
  });
});

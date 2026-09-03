import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateForgeSkills } from "./forge-skills";

describe("activateForgeSkills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-ext-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("contributes only the forge directory skills", async () => {
    fs.mkdirSync(path.join(tempDir, ".forge", "skills", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".forge", "skills", "demo", "SKILL.md"),
      "---\nname: demo\n---\n",
    );

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, path.join(tempDir, ".forge"));

    const result = (await pi.getHandler("resources_discover")!()) as {
      skillPaths?: string[];
    };
    expect(result).toEqual({ skillPaths: [path.join(tempDir, ".forge", "skills")] });
  });

  it("contributes nothing when the forge skills directory is missing", async () => {
    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, path.join(tempDir, ".forge"));

    const result = await pi.getHandler("resources_discover")!();
    expect(result).toEqual({});
  });

  it("does not fall back to bundled skill directories", async () => {
    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, path.join(tempDir, ".forge"));

    const result = (await pi.getHandler("resources_discover")!()) as {
      skillPaths?: string[];
    };
    expect(result.skillPaths ?? []).toEqual([]);
  });
});

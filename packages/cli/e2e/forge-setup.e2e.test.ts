/**
 * End-to-end tests for the `.gitignore` block appended by `forge-setup.js`
 * (the script behind `/forge:init`).
 *
 * Runs the real script in a temp git repository with a fake `pi` binary on
 * PATH, then asserts that init appends exactly the sentinel
 * `# Feature Forge runtime` plus the three runtime-artifact entries, that no
 * other entries are appended, that re-runs are idempotent, and that global
 * mode appends the same block as local mode.
 *
 * Run via: `npm run test:e2e`
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PROJECT_ROOT } from "./helpers";

const SETUP_SCRIPT = join(PROJECT_ROOT, "scripts", "forge-setup.js");

const SENTINEL = "# Feature Forge runtime";
const EXPECTED_ENTRIES = [SENTINEL, ".forge/worktrees", ".forge/worktrees.json", ".forge/logs"];
const FORBIDDEN_ENTRIES = [
  ".forge/*",
  "!.forge/config.json",
  "coverage-single/",
  ".pi",
  ".env",
  ".env.local",
];

let fakeBinDir: string;
let repoRoot: string;

/** Create a temp git repo with one committed file so HEAD is clean. */
function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-init-"));
  exec("git init --initial-branch=main", dir);
  exec('git config user.email "test@forge.local"', dir);
  exec('git config user.name "Forge E2E"', dir);
  writeFileSync(join(dir, "README.md"), "# test repo\n");
  exec("git add README.md", dir);
  exec('git commit -m "initial commit"', dir);
  return dir;
}

/** Run a shell command in a directory, returning trimmed stdout. */
function exec(command: string, dir: string): string {
  return spawnSync(command, { cwd: dir, encoding: "utf8", shell: true }).stdout.trim();
}

/** Run forge-setup.js against a repo, returning the spawn result. */
function runSetup(repo: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SETUP_SCRIPT, "--cwd", repo], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      ...extraEnv,
    },
  });
}

/** Non-empty .gitignore lines (the block appended by init). */
function gitignoreLines(repo: string): string[] {
  const content = readFileSync(join(repo, ".gitignore"), "utf8");
  return content.split("\n").filter((line) => line.trim().length > 0);
}

describe("forge-setup.js .gitignore (e2e)", () => {
  beforeAll(() => {
    // Fake `pi` binary so the prerequisite check passes without a real install.
    fakeBinDir = mkdtempSync(join(tmpdir(), "forge-e2e-init-bin-"));
    const piShim = join(fakeBinDir, "pi");
    writeFileSync(piShim, "#!/bin/sh\nexit 0\n");
    chmodSync(piShim, 0o755);
  });

  afterAll(() => {
    rmSync(fakeBinDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    repoRoot = createTempRepo();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("appends exactly the runtime-artifact block in local mode (AC1 + AC2)", () => {
    const result = runSetup(repoRoot);

    expect(result.status).toBe(0);
    expect(gitignoreLines(repoRoot)).toEqual(EXPECTED_ENTRIES);
    for (const entry of FORBIDDEN_ENTRIES) {
      expect(gitignoreLines(repoRoot)).not.toContain(entry);
    }
  });

  it("appends the same block in global mode (AC4)", () => {
    const globalHome = mkdtempSync(join(tmpdir(), "forge-e2e-init-home-"));
    try {
      const result = runSetup(repoRoot, { HOME: globalHome });

      expect(result.status).toBe(0);
      expect(gitignoreLines(repoRoot)).toEqual(EXPECTED_ENTRIES);
    } finally {
      rmSync(globalHome, { recursive: true, force: true });
    }
  });

  it("preserves existing .gitignore content and is idempotent (AC3)", () => {
    const gitignorePath = join(repoRoot, ".gitignore");
    writeFileSync(gitignorePath, "node_modules/\n");

    const first = runSetup(repoRoot);
    expect(first.status).toBe(0);
    expect(readFileSync(gitignorePath, "utf8")).toBe(
      "node_modules/\n" + "\n" + EXPECTED_ENTRIES.join("\n") + "\n",
    );

    const second = runSetup(repoRoot);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already contains forge entries");
    expect(readFileSync(gitignorePath, "utf8")).toBe(
      "node_modules/\n" + "\n" + EXPECTED_ENTRIES.join("\n") + "\n",
    );
  });
});

/**
 * End-to-end tests for `forge-setup.js` (the script behind `/forge:init`).
 *
 * Runs the real script in a temp git repository with a fake `pi` binary on
 * PATH, then asserts:
 * - the `.gitignore` block appended by init: exactly the sentinel
 *   `# Feature Forge runtime` plus the three runtime-artifact entries, no
 *   other entries, idempotent across re-runs, identical in both scopes
 * - scaffolding into one of the two fixed homes: `~/.forge` (`--global`) or
 *   `<cwd>/.forge` (default), with agents/flows/skills/config.json, and no
 *   `forgeDir` pointer key anywhere in the scaffolded config
 * - runtime dirs (`.forge/logs`, `.forge/worktrees`) always stay project-local
 * - `--no-config` skips config creation in both scopes
 *
 * Run via: `npm run test:e2e`
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
function runSetup(repo: string, options: { args?: string[]; env?: Record<string, string> } = {}) {
  return spawnSync(process.execPath, [SETUP_SCRIPT, "--cwd", repo, ...(options.args ?? [])], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      ...(options.env ?? {}),
    },
  });
}

/** Non-empty .gitignore lines (the block appended by init). */
function gitignoreLines(repo: string): string[] {
  const content = readFileSync(join(repo, ".gitignore"), "utf8");
  return content.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * Run a callback with HOME stubbed at a fresh temp home; cleans the home
 * up afterwards. Global-scope setup writes into `~/.forge`, so tests stub
 * HOME to keep the real user home untouched.
 */
function withStubbedHome(run: (globalHome: string) => void): void {
  const globalHome = mkdtempSync(join(tmpdir(), "forge-e2e-init-home-"));
  try {
    run(globalHome);
  } finally {
    rmSync(globalHome, { recursive: true, force: true });
  }
}

/** First scaffolded template FILE under a forge dir (agents, flows, skills). */
function firstTemplateFile(forgeDir: string): string | null {
  const walk = (current: string): string | null => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const p = join(current, entry.name);
      if (entry.isDirectory()) {
        const nested = walk(p);
        if (nested) return nested;
        // Empty subtree - keep scanning siblings.
      } else if (entry.isFile()) {
        return p;
      }
    }
    return null;
  };
  for (const sub of ["agents", "flows", "skills"]) {
    const dir = join(forgeDir, sub);
    if (!existsSync(dir)) continue;
    const found = walk(dir);
    if (found) return found;
  }
  return null;
}

/** Assert the three template dirs + config exist in a forge dir and are non-empty. */
function expectScaffoldedHome(forgeDir: string, configExpected: boolean) {
  for (const sub of ["agents", "flows", "skills"]) {
    const dir = join(forgeDir, sub);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  }
  expect(existsSync(join(forgeDir, "config.json"))).toBe(configExpected);
}

describe("forge-setup.js (e2e)", () => {
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

  describe(".gitignore", () => {
    it("appends exactly the runtime-artifact block in local mode", () => {
      const result = runSetup(repoRoot);

      expect(result.status).toBe(0);
      expect(gitignoreLines(repoRoot)).toEqual(EXPECTED_ENTRIES);
      for (const entry of FORBIDDEN_ENTRIES) {
        expect(gitignoreLines(repoRoot)).not.toContain(entry);
      }
    });

    it("appends the same block in global mode and never writes a project config", () => {
      withStubbedHome((globalHome) => {
        const result = runSetup(repoRoot, { args: ["--global"], env: { HOME: globalHome } });

        expect(result.status).toBe(0);
        expect(gitignoreLines(repoRoot)).toEqual(EXPECTED_ENTRIES);
        // No pointer/config lands in the project's .forge/ during global init.
        expect(existsSync(join(repoRoot, ".forge", "config.json"))).toBe(false);
      });
    });

    it("preserves existing .gitignore content and is idempotent", () => {
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

  describe("scaffolding & fixed homes", () => {
    it("rejects the removed --forge-dir flag", () => {
      const result = runSetup(repoRoot, { args: ["--forge-dir", "/tmp/somewhere"] });

      // The forge directory is fixed to the two homes now; the flag that
      // used to redirect it must be rejected, not silently ignored.
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Unknown flag: --forge-dir");
    });

    it("--global scaffolds ~/.forge under the stubbed HOME and keeps runtime dirs project-local", () => {
      withStubbedHome((globalHome) => {
        const result = runSetup(repoRoot, { args: ["--global"], env: { HOME: globalHome } });

        expect(result.status).toBe(0);
        const globalForge = join(globalHome, ".forge");
        expectScaffoldedHome(globalForge, true);

        // No .forge/config.json in the project dir (no pointer file ever).
        const projectForge = join(repoRoot, ".forge");
        expect(existsSync(join(projectForge, "config.json"))).toBe(false);

        // Runtime dirs stay under the project cwd in both scopes.
        for (const sub of ["logs", "worktrees"]) {
          const dir = join(projectForge, sub);
          expect(existsSync(dir)).toBe(true);
          expect(statSync(dir).isDirectory()).toBe(true);
        }

        // Output must not reference the removed pointer/backup machinery.
        expect(result.stdout + result.stderr).not.toMatch(/forgeDir|wrote pointer|\.backup/);
      });
    });

    it("project scope scaffolds <cwd>/.forge with config, agents, flows, skills", () => {
      const result = runSetup(repoRoot);

      expect(result.status).toBe(0);
      const projectForge = join(repoRoot, ".forge");
      expectScaffoldedHome(projectForge, true);
      for (const sub of ["logs", "worktrees"]) {
        expect(existsSync(join(projectForge, sub))).toBe(true);
      }

      // The scaffolded config carries defaults and never a forgeDir key.
      const config = JSON.parse(readFileSync(join(projectForge, "config.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect(config.logLevel).toBe("info");
      expect("forgeDir" in config).toBe(false);
    });

    it("re-running is idempotent: existing config and template files survive untouched", () => {
      const first = runSetup(repoRoot);
      expect(first.status).toBe(0);

      const projectForge = join(repoRoot, ".forge");
      const configPath = join(projectForge, "config.json");
      const templateFile = firstTemplateFile(projectForge);
      expect(templateFile).not.toBeNull();

      // Simulate user edits, then re-run init - nothing may be clobbered.
      const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      config.e2eMarker = "user-edit";
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      const templateContent = readFileSync(templateFile!, "utf8");

      const second = runSetup(repoRoot);
      expect(second.status).toBe(0);
      expect(second.stdout + second.stderr).toContain(
        `config.json already exists in ${projectForge}`,
      );

      const after = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
      expect(after.e2eMarker).toBe("user-edit");
      expect(readFileSync(templateFile!, "utf8")).toBe(templateContent);
    });

    it("--no-config skips config creation in both scopes", () => {
      const project = runSetup(repoRoot, { args: ["--no-config"] });
      expect(project.status).toBe(0);
      expectScaffoldedHome(join(repoRoot, ".forge"), false);

      withStubbedHome((globalHome) => {
        const global = runSetup(repoRoot, {
          args: ["--global", "--no-config"],
          env: { HOME: globalHome },
        });
        expect(global.status).toBe(0);
        expectScaffoldedHome(join(globalHome, ".forge"), false);
        expect(existsSync(join(repoRoot, ".forge", "config.json"))).toBe(false);
      });
    });
  });
});

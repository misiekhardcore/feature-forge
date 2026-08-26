#!/usr/bin/env node
/**
 * Live pi-session smoke test for the worktree registry hardening (PR #247).
 *
 * Boots a real pi process against a built extension bundle and verifies the
 * behaviors that unit/e2e tests cannot reach: session attribution (the
 * `session_start` hook), startup reconciliation after a simulated crash, and
 * corrupt-file resilience at extension load.
 *
 * Usage:
 *   node packages/cli/scripts/test-worktree-registry-live.mjs [options]
 *
 * Options:
 *   --dist <path>    Built extension bundle (default: packages/cli/dist/index.js)
 *   --branch <name>  Build the bundle from this branch in a temp worktree first
 *   --model <id>     Model for the headless pi session (default: deepseek/deepseek-v4-flash)
 *   --keep           Keep the scratch repo on failure (default: clean up)
 *   --verbose        Print pi session output
 *
 * Exit code 0 = all scenarios pass; 1 = any assertion failed; 2 = usage error.
 *
 * Notes:
 * - Requires `pi` on PATH, an authenticated model provider, and a working
 *   `npm run build`. The headless pi run is a real LLM session - it is slow
 *   (seconds to tens of seconds per scenario) but deterministic in its
 *   filesystem effects, which is what the script asserts on.
 * - When --branch is used the worktree is created under .forge/worktrees/
 *   with a node_modules mirror (real dir + @feature-forge/* symlinks to the
 *   worktree's own packages) so tsup bundles the branch's core, not main's.
 * - The temp worktree is added detached so --branch also works when the
 *   branch is the one the script itself runs from (already checked out).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_DIST = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");
const FORGE_DIR = path.join(REPO_ROOT, ".forge");

// Colours
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function ok(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg) {
  console.log(`${RED}✗${RESET} ${msg}`);
}
function info(msg) {
  console.log(`${CYAN}•${RESET} ${msg}`);
}

function parseArgs(argv) {
  const args = {
    dist: DEFAULT_DIST,
    model: "deepseek/deepseek-v4-flash",
    keep: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`Option ${arg} requires a value`);
        process.exit(2);
      }
      return value;
    };
    switch (arg) {
      case "--dist":
        args.dist = next();
        break;
      case "--branch":
        args.branch = next();
        break;
      case "--model":
        args.model = next();
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--verbose":
        args.verbose = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(2);
    }
  }
  return args;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf-8", ...opts });
  if (res.error) throw res.error;
  return res;
}

function runOk(cmd, args, opts = {}) {
  const res = run(cmd, args, opts);
  if (res.status !== 0) {
    throw new Error(`Command failed (${cmd} ${args.join(" ")}):\n${res.stderr || res.stdout}`);
  }
  return res;
}

function buildFromBranch(branch) {
  const wsName = `ws-livetest-${Date.now()}`;
  const wsPath = path.join(FORGE_DIR, "worktrees", wsName);
  info(`Creating worktree on ${branch} at ${wsPath}`);
  // Detached: the branch may be checked out elsewhere (e.g. this script's own
  // worktree); we only need the files to build, not a checked-out branch.
  runOk("git", ["worktree", "add", "--detach", wsPath, branch], { cwd: REPO_ROOT });

  const mainNodeModules = path.join(REPO_ROOT, "node_modules");
  const wsNodeModules = path.join(wsPath, "node_modules");
  fs.mkdirSync(wsNodeModules, { recursive: true });
  for (const entry of fs.readdirSync(mainNodeModules, { withFileTypes: true })) {
    if (entry.name === "@feature-forge") continue;
    fs.symlinkSync(path.join(mainNodeModules, entry.name), path.join(wsNodeModules, entry.name));
  }
  const wsPackages = fs.readdirSync(path.join(wsPath, "packages"), { withFileTypes: true });
  fs.mkdirSync(path.join(wsNodeModules, "@feature-forge"), { recursive: true });
  for (const pkg of wsPackages) {
    if (!pkg.isDirectory()) continue;
    fs.symlinkSync(
      path.join(wsPath, "packages", pkg.name),
      path.join(wsNodeModules, "@feature-forge", pkg.name),
    );
  }

  info("Building extension bundle");
  runOk("npm", ["run", "build"], { cwd: wsPath, timeout: 300_000 });
  const dist = path.join(wsPath, "packages", "cli", "dist", "index.js");
  if (!fs.existsSync(dist)) {
    throw new Error(`Build did not produce ${dist}`);
  }
  return { wsPath, dist };
}

function createScratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-livetest-"));
  runOk("git", ["init", "-q", "-b", "main"], { cwd: dir });
  runOk("git", ["config", "user.email", "test@forge.local"], { cwd: dir });
  runOk("git", ["config", "user.name", "Forge Live Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "# live test repo\n");
  runOk("git", ["add", "README.md"], { cwd: dir });
  runOk("git", ["commit", "-qm", "init"], { cwd: dir });
  fs.mkdirSync(path.join(dir, ".forge"), { recursive: true });
  for (const sub of ["agents", "flows", "skills"]) {
    const src = path.join(FORGE_DIR, sub);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(dir, ".forge", sub), { recursive: true });
    }
  }
  const configSrc = path.join(FORGE_DIR, "config.json");
  if (fs.existsSync(configSrc)) {
    fs.copyFileSync(configSrc, path.join(dir, ".forge", "config.json"));
  }
  return dir;
}

function piPrompt(dist, cwd, prompt, model, verbose) {
  const args = ["-p", "-ne", "-e", dist, "--model", model, "--thinking", "low", prompt];
  const res = run("pi", args, { cwd, timeout: 180_000 });
  if (verbose) {
    console.log(`--- pi output (${cwd}) ---`);
    console.log((res.stdout || "").trim());
    if (res.stderr) console.log((res.stderr || "").trim());
    console.log("--- end pi output ---");
  }
  return res;
}

function latestLog(dir) {
  const logDir = path.join(dir, ".forge", "logs");
  if (!fs.existsSync(logDir)) return undefined;
  const logs = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith(".log"))
    .sort();
  return logs.length ? path.join(logDir, logs[logs.length - 1]) : undefined;
}

// FileLogger writes hourly forge-YYYYMMDDTHH.log files shared by every session
// in the same hour, so scenario assertions read only the tail appended by the
// session just run instead of the whole shared file.
function captureLogState(dir) {
  const log = latestLog(dir);
  if (!log) return undefined;
  return { file: log, size: fs.statSync(log).size };
}

function readLogTail(dir, state) {
  const log = latestLog(dir);
  if (!log) return undefined;
  const content = fs.readFileSync(log, "utf-8");
  if (state && state.file === log) {
    return content.slice(state.size);
  }
  return content;
}

function readRegistry(dir) {
  const p = path.join(dir, ".forge", "worktrees.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    // Unparsable file - the extension starts with an empty in-memory registry
    // and never rewrites the corrupt file, so treat it as absent.
    return undefined;
  }
}

function assert(cond, msg) {
  if (!cond) {
    fail(msg);
    throw new Error(msg);
  }
  ok(msg);
}

function scenarioSessionAttribution(dist, repo, model, verbose) {
  info("Scenario 1: session attribution (v1 envelope + sessionId)");
  const res = piPrompt(
    dist,
    repo,
    "Use the create_workspace tool with no arguments. Report the exact workspace path returned.",
    model,
    verbose,
  );
  assert(res.status === 0, "pi session exits 0 after creating a workspace");
  const registry = readRegistry(repo);
  assert(registry !== undefined, "registry file .forge/worktrees.json exists");
  assert(registry.version === 1, "registry file uses version: 1 envelope");
  assert(
    Array.isArray(registry.worktrees) && registry.worktrees.length >= 1,
    "worktrees is a non-empty array",
  );
  const entry = registry.worktrees[0];
  assert(typeof entry.path === "string" && entry.path.length > 0, "entry has non-empty path");
  assert(typeof entry.branch === "string" && entry.branch.length > 0, "entry has non-empty branch");
  assert(
    typeof entry.sessionId === "string" && entry.sessionId.length > 0,
    `entry has sessionId stamped by the session hook (${entry.sessionId})`,
  );
  return entry;
}

function scenarioCrashResume(dist, repo, entry, model, verbose) {
  info("Scenario 2: startup reconciliation after simulated crash");
  if (entry && fs.existsSync(entry.path)) {
    fs.rmSync(entry.path, { recursive: true, force: true });
  }
  runOk("git", ["worktree", "prune"], { cwd: repo });
  if (entry) {
    run("git", ["branch", "-D", entry.branch], { cwd: repo });
  }
  const logBefore = captureLogState(repo);
  const res = piPrompt(dist, repo, "Reply with exactly: RESTARTED", model, verbose);
  assert(res.status === 0, "pi restarts cleanly after crash leftovers");
  const content = readLogTail(repo, logBefore) ?? "";
  assert(content.length > 0, "session appended to a forge log file");
  assert(
    content.includes("reconciliation found issues"),
    "startup log contains reconciliation warning",
  );
  assert(content.includes("staleRegistryEntries"), "reconciliation reports stale registry entries");
}

function scenarioCorruptFile(dist, repo, model, verbose) {
  info("Scenario 3: corrupt file must not brick the extension");
  fs.writeFileSync(path.join(repo, ".forge", "worktrees.json"), "this is not json {{{");
  const logBefore = captureLogState(repo);
  const res = piPrompt(dist, repo, "Reply with exactly: SURVIVED_CORRUPT", model, verbose);
  assert(res.status === 0, "extension loads despite corrupt registry file");
  const content = readLogTail(repo, logBefore) ?? "";
  assert(
    content.includes("starting with an empty registry"),
    "startup log warns and starts with empty registry",
  );
  const registry = readRegistry(repo);
  assert(
    registry === undefined || registry.worktrees.length === 0,
    "no registry entries survive a corrupt file",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let wsPath;
  let dist = args.dist;

  try {
    if (args.branch) {
      const built = buildFromBranch(args.branch);
      wsPath = built.wsPath;
      dist = built.dist;
    }
    if (!fs.existsSync(dist)) {
      console.error(`Extension bundle not found: ${dist}\nRun "npm run build" or pass --dist.`);
      process.exit(2);
    }
    info(`Using extension bundle: ${dist}`);
    info(`Model: ${args.model}`);

    const repo = createScratchRepo();
    info(`Scratch repo: ${repo}`);

    // Run every scenario so a broken build is diagnosed as completely as
    // possible; a failure in one scenario must not mask the others.
    let failures = 0;
    const runScenario = (name, fn) => {
      try {
        fn();
      } catch (error) {
        failures++;
        fail(`Scenario failed (${name}): ${error.message}`);
      }
    };

    let entry;
    runScenario("session attribution", () => {
      entry = scenarioSessionAttribution(dist, repo, args.model, args.verbose);
    });
    runScenario("crash resume", () => {
      scenarioCrashResume(dist, repo, entry, args.model, args.verbose);
    });
    runScenario("corrupt file", () => {
      scenarioCorruptFile(dist, repo, args.model, args.verbose);
    });

    if (failures === 0) {
      console.log(`\n${GREEN}All live-pi scenarios passed.${RESET}`);
    } else {
      console.log(`\n${RED}${failures} live-pi scenario(s) failed.${RESET}`);
    }

    if (!args.keep) {
      fs.rmSync(repo, { recursive: true, force: true });
    } else {
      info(`Scratch repo retained at ${repo}`);
    }

    if (failures > 0) {
      process.exit(1);
    }
  } finally {
    if (wsPath) {
      info(`Removing temp worktree ${wsPath}`);
      try {
        runOk("git", ["worktree", "remove", "--force", wsPath], { cwd: REPO_ROOT });
      } catch (error) {
        fail(`Failed to remove temp worktree: ${error.message}`);
      }
    }
  }
}

main();

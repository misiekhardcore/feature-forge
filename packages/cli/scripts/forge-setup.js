#!/usr/bin/env node
/**
 * Feature Forge project scaffolding.
 *
 * Replaces the former forge-setup.sh: checks prerequisites, scaffolds
 * agents, flows, skills, config, and runtime directories into the forge
 * directory, and appends .gitignore entries.
 *
 * Usage: forge-setup.js [--yes] [--no-config] [--no-gitignore]
 *                      [--cwd <path>] [--global] [--forge-dir <path>]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Colours ───────────────────────────────────────────────────────────
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

const logInfo = (...msg) => console.log(`${GREEN}[forge]${NC}`, ...msg);
const logWarn = (...msg) => console.warn(`${YELLOW}[forge]${NC}`, ...msg);
const logError = (...msg) => console.error(`${RED}[forge]${NC}`, ...msg);

// ── Defaults ──────────────────────────────────────────────────────────
let useGlobal = false;
let forgeDirFlag = null;
let noConfig = false;
let noGitignore = false;
let cwd = process.cwd();

// ── Parse flags ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  switch (args[i]) {
    case "--yes":
      // Accepted for CLI parity; setup is non-interactive already.
      break;
    case "--global":
      useGlobal = true;
      break;
    case "--forge-dir":
      if (i + 1 >= args.length) {
        logError("flag --forge-dir requires a value");
        process.exit(1);
      }
      forgeDirFlag = args[i + 1];
      i += 1;
      break;
    case "--no-config":
      noConfig = true;
      break;
    case "--no-gitignore":
      noGitignore = true;
      break;
    case "--cwd":
      if (i + 1 >= args.length) {
        logError("flag --cwd requires a value");
        process.exit(1);
      }
      cwd = args[i + 1];
      i += 1;
      break;
    default:
      logError(`Unknown flag: ${args[i]}`);
      process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !(result.error && result.error.code === "ENOENT");
}

/**
 * Resolve the directory that contains the built-in template assets
 * (agents, flows, skills) to scaffold.
 *
 * The script can run from three layouts:
 * - `<pkg>/scripts/` (published package, invoked by the extension)
 *   → assets in `<pkg>/dist/`
 * - `<pkg>/dist/scripts/` (built copy)
 *   → assets in `<pkg>/dist/`
 * - `<pkg>/scripts/` in the source tree (dev)
 *   → assets in `<pkg>/src/`
 */
function resolveAssetsDir() {
  const scriptDir = path.join(__dirname, "..");
  const candidates = [scriptDir, path.join(scriptDir, "dist"), path.join(scriptDir, "src")];
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "agents", "declarative-specs")) ||
      fs.existsSync(path.join(dir, "flows"))
    ) {
      return dir;
    }
  }
  // Fallback — let the copy functions report clear errors.
  return scriptDir;
}

/**
 * Compute the resolved forge directory path from flags.
 *
 * - `--global` → `~/.forge`
 * - `--forge-dir <path>` → the given path, resolved
 * - default → `.forge` relative to cwd
 */
function computeForgeDir() {
  let raw;
  if (useGlobal) {
    raw = "~/.forge";
  } else if (forgeDirFlag) {
    raw = forgeDirFlag;
  } else {
    raw = ".forge";
  }

  if (raw.startsWith("~")) {
    return path.join(os.homedir(), raw.slice(1));
  }
  return path.resolve(cwd, raw);
}

// ── Resolve canonical defaults JSON ──────────────────────────────────
function resolveDefaultsPath() {
  try {
    // Monorepo dev: resolves via workspace symlink
    return require.resolve("@feature-forge/shared/src/config/forge-config.defaults.json");
  } catch {
    const candidates = [
      // Source layout: <pkg>/scripts/forge-config.defaults.json (next to script)
      path.join(__dirname, "forge-config.defaults.json"),
      // Built layout: <pkg>/dist/scripts/forge-config.defaults.json
      path.join(__dirname, "..", "dist", "scripts", "forge-config.defaults.json"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return candidates[0];
  }
}

// ── Check prerequisites ───────────────────────────────────────────────
function checkPrereqs() {
  let failures = 0;

  if (!commandAvailable("git")) {
    logError("git is not available — please install git");
    failures += 1;
  } else {
    const inRepo = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      stdio: "ignore",
    });
    if (inRepo.status !== 0) {
      logError("not inside a git worktree — run from a git repository");
      failures += 1;
    }
  }

  if (!commandAvailable("pi")) {
    logError("pi CLI is not available — please install @earendil-works/pi-coding-agent");
    failures += 1;
  }

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22) {
    logError(`Node.js >= 22 is required (found: ${process.versions.node})`);
    failures += 1;
  }

  return failures;
}

// ── Scaffold .forge/config.json ──────────────────────────────────────
function scaffoldConfig(forgeDir) {
  const target = path.join(forgeDir, "config.json");
  if (fs.existsSync(target)) {
    logWarn(".forge/config.json already exists — skipping");
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const defaults = JSON.parse(fs.readFileSync(resolveDefaultsPath(), "utf8"));
  fs.writeFileSync(target, `${JSON.stringify(defaults, null, 2)}\n`);
  logInfo("created .forge/config.json");
}

// ── Create runtime directories (always project-local) ────────────────
function createDirs() {
  fs.mkdirSync(path.join(cwd, ".forge", "logs"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".forge", "worktrees"), { recursive: true });
  logInfo("created .forge/logs and .forge/worktrees");
}

// ── Copy files non-destructively (skip existing destinations) ────────
function copyMissingFiles(src, dest) {
  let created = 0;
  let skipped = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const nested = copyMissingFiles(srcPath, destPath);
      created += nested.created;
      skipped += nested.skipped;
    } else if (entry.isFile()) {
      if (fs.existsSync(destPath)) {
        skipped += 1;
      } else {
        fs.copyFileSync(srcPath, destPath);
        created += 1;
      }
    }
  }
  return { created, skipped };
}

// ── Copy templates from dist into forgeDir ────────────────────────────
function scaffoldTemplates(forgeDir) {
  const srcDir = resolveAssetsDir();

  // Agents: copy .md files from <assets>/agents/declarative-specs → forgeDir/agents/
  const agentsSrc = path.join(srcDir, "agents", "declarative-specs");
  const agentsDest = path.join(forgeDir, "agents");
  if (fs.existsSync(agentsSrc)) {
    let created = 0;
    let skipped = 0;
    fs.mkdirSync(agentsDest, { recursive: true });
    for (const entry of fs.readdirSync(agentsSrc, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const destFile = path.join(agentsDest, entry.name);
        if (fs.existsSync(destFile)) {
          skipped += 1;
        } else {
          fs.copyFileSync(path.join(agentsSrc, entry.name), destFile);
          created += 1;
        }
      }
    }
    logInfo(`scaffolded ${created} file(s) to ${agentsDest}, skipped ${skipped} existing`);
  }

  // Flows: copy <assets>/flows → forgeDir/flows (skip existing files)
  const flowsSrc = path.join(srcDir, "flows");
  const flowsDest = path.join(forgeDir, "flows");
  if (fs.existsSync(flowsSrc)) {
    const { created, skipped } = copyMissingFiles(flowsSrc, flowsDest);
    logInfo(`scaffolded ${created} file(s) to ${flowsDest}, skipped ${skipped} existing`);
  }

  // Skills: copy <assets>/skills → forgeDir/skills (skip existing files)
  const skillsSrc = path.join(srcDir, "skills");
  const skillsDest = path.join(forgeDir, "skills");
  if (fs.existsSync(skillsSrc)) {
    const { created, skipped } = copyMissingFiles(skillsSrc, skillsDest);
    logInfo(`scaffolded ${created} file(s) to ${skillsDest}, skipped ${skipped} existing`);
  }
}

// ── Append gitignore entries ──────────────────────────────────────────
function appendGitignore() {
  const gitignorePath = path.join(cwd, ".gitignore");
  const sentinel = "# Feature Forge runtime";
  if (fs.existsSync(gitignorePath) && fs.readFileSync(gitignorePath, "utf8").includes(sentinel)) {
    logInfo(".gitignore already contains forge entries — skipping");
    return;
  }
  const entries = [
    "",
    sentinel,
    ".forge/*",
    "!.forge/config.json",
    "coverage-single/",
    "",
    "# pi coding agent runtime",
    ".pi",
    "",
    "# Environment overrides",
    ".env",
    ".env.local",
  ];
  fs.appendFileSync(gitignorePath, `${entries.join("\n")}\n`);
  logInfo("appended forge entries to .gitignore");
}

// ── Main ──────────────────────────────────────────────────────────────
fs.mkdirSync(cwd, { recursive: true });

if (checkPrereqs() > 0) {
  logError("prerequisite checks failed — aborting");
  process.exit(1);
}

const forgeDir = computeForgeDir();
logInfo(`forge directory: ${forgeDir}`);

// Scaffold templates (agents, flows, skills) into forgeDir
scaffoldTemplates(forgeDir);

if (!noConfig) {
  scaffoldConfig(forgeDir);

  if (useGlobal) {
    // Write a pointer file in the project's .forge/ so the runtime
    // knows to look for the real config at ~/.forge/config.json.
    const pointerPath = path.join(cwd, ".forge", "config.json");
    fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
    fs.writeFileSync(pointerPath, JSON.stringify({ forgeDir: "~/.forge" }, null, 2) + "\n");
    logInfo(`wrote pointer ${pointerPath} → ~/.forge`);
  }
}

// Runtime directories always go under the project's .forge/
createDirs();

// Gitignore entries are skipped for global forge — the project's
// .forge/ only contains logs, worktrees, and the pointer config.
if (!noGitignore && !useGlobal) {
  appendGitignore();
}

logInfo(`Feature Forge initialized successfully in ${cwd}`);

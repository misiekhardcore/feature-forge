#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, "..", "dist", "scripts", "forge-setup.js");

const args = process.argv.slice(2);
if (args[0] !== "init") {
  console.log("Usage: forge init [--yes] [--no-config] [--no-gitignore] [--cwd <path>]");
  process.exit(args[0] === "--help" || args[0] === "-h" ? 0 : 1);
}

const child = spawn("node", [scriptPath, ...args.slice(1)], { stdio: "inherit" });
child.on("error", (err) => {
  console.error("Failed to run forge-setup.js:", err.message);
  process.exit(1);
});
child.on("close", (code) => {
  process.exit(code ?? 1);
});

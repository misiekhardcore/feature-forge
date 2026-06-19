import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PiSpawnResult {
  stdout: string;
  exitCode: number;
}

export interface PiSpawnOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Resolves the pi binary path. Tries the installed package first,
 * falls back to PATH.
 */
export function resolvePiBinary(): string {
  try {
    const packageRoot = resolvePackageRoot();
    if (packageRoot) {
      const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8")) as {
        bin?: string | Record<string, string>;
      };
      const binField = pkg.bin;
      const binPath =
        typeof binField === "string"
          ? binField
          : (binField?.["pi"] ?? Object.values(binField ?? {})[0]);
      if (binPath) {
        const candidate = join(packageRoot, binPath);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // fall through to PATH
  }
  return "pi";
}

function resolvePackageRoot(): string | undefined {
  try {
    const resolved = fileURLToPath(import.meta.resolve(PI_PACKAGE));
    let dir = dirname(resolved);
    while (dir !== dirname(dir)) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === PI_PACKAGE) return dir;
      }
      dir = dirname(dir);
    }
  } catch {
    // not resolvable
  }
  return undefined;
}

/**
 * Spawns `pi -p <prompt>` as a child process and captures stdout.
 *
 * - Pipes the prompt text as a command-line argument (no temp files).
 * - Captures all stdout output.
 * - Resolves with { stdout, exitCode } on completion.
 * - Rejects on spawn error or timeout.
 */
export class PiSpawner {
  private readonly piPath: string;

  constructor(piPath?: string) {
    this.piPath = piPath ?? resolvePiBinary();
  }

  async run(prompt: string, options: PiSpawnOptions = {}): Promise<PiSpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.piPath, ["-p", prompt], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"],
        signal: options.signal,
        timeout: options.timeout,
      });

      const chunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      let stderrBuf = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      child.on("error", (err) => {
        reject(
          new Error(`PiSpawner failed: ${err.message}${stderrBuf ? `\nstderr: ${stderrBuf}` : ""}`),
        );
      });

      child.on("close", (exitCode) => {
        const stdout = Buffer.concat(chunks).toString("utf-8");
        resolve({ stdout, exitCode: exitCode ?? 1 });
      });
    });
  }
}

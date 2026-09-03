/**
 * End-to-end wiring test for the skill toolset at the composition root.
 *
 * Boots the real feature-forge extension (packages/cli/src/index.ts) inside
 * a sandboxed temp git repo scaffolded with a minimal `.forge/` (config,
 * agent spec, flows dir), then asserts on the exact surface pi receives:
 *
 * - the booted extension registers `skill_validate` and `skill_persist`
 * - the registered `skill_validate` instance returns `passed: false` text
 *   for a malformed fixture skill (deterministic structure gate works on
 *   the instance pi actually holds)
 * - the root-only session extensions (forge-init-context, skill-nudge) are
 *   activated in a root session but not in a child session
 *   (FORGE_PARENT_SOCKET set) — the Loop 2 review M2 guard
 *
 * The boot is in-process (like tool-restrictions-interceptor.e2e.test.ts)
 * rather than a real `pi` subprocess: tool registration is a pure
 * extension-load side effect, so a mock ExtensionAPI that records
 * registerTool/on calls exercises the composition-root wiring end to end
 * without a model or TUI.
 *
 * Prerequisites: `pi` CLI must be on PATH for the child-mode server check
 * only; the extension itself boots in-process.
 */

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ParentSocketServer } from "@feature-forge/core/ipc";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import featureForgeExtension from "../src/index";
import { makeMockPi, makeMockSpecManager } from "../src/test-utils";

const CLI_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = join(CLI_ROOT, "..", "..");
const FORGE_CONFIG_SOURCE = join(REPO_ROOT, ".forge", "config.json");

/** Minimal declarative agent spec — the shape SpecLoader.loadFromDirectory accepts. */
const AGENT_SPEC = `---
id: "e2e-skill-tools"
role: "e2e-skill-tools"
tools: ["read"]
---

E2E sandbox agent spec.
`;

let sandbox: string;
let originalParentSocket: string | undefined;
let originalCwd: string;

/** Scaffold a temp git repo with a minimal .forge/ so the real extension boots fully. */
function scaffoldSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-skill-tools-"));
  execSync("git init --initial-branch=main", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@forge.local"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "Forge E2E"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "README.md"), "# e2e sandbox\n");
  execSync("git add README.md", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "initial"', { cwd: dir, stdio: "ignore" });

  // .forge/ — the tracked repo config is known schema-valid and boots the
  // extension exactly like a dev checkout would.
  mkdirSync(join(dir, ".forge", "agents"), { recursive: true });
  mkdirSync(join(dir, ".forge", "flows"), { recursive: true });
  cpSync(FORGE_CONFIG_SOURCE, join(dir, ".forge", "config.json"));
  writeFileSync(join(dir, ".forge", "agents", "e2e-skill-tools.md"), AGENT_SPEC);

  // Malformed fixture skill — body without YAML frontmatter fences.
  const fixture = join(dir, "fixtures", "bad-skill");
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, "SKILL.md"), "no frontmatter here\n");
  return dir;
}

/** Boot the real extension factory against the sandbox; returns the mock pi. */
async function bootExtension(pi: ReturnType<typeof makeMockPi>): Promise<void> {
  await featureForgeExtension(pi);
}

describe("skill toolset wiring (e2e)", () => {
  beforeAll(() => {
    sandbox = scaffoldSandbox();
    originalParentSocket = process.env.FORGE_PARENT_SOCKET;
    originalCwd = process.cwd();
    delete process.env.FORGE_PARENT_SOCKET;
    process.chdir(sandbox);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    if (originalParentSocket !== undefined) {
      process.env.FORGE_PARENT_SOCKET = originalParentSocket;
    } else {
      delete process.env.FORGE_PARENT_SOCKET;
    }
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  it("registers skill_validate and skill_persist on a real extension boot", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    const registered = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => (call[0] as { name?: string }).name)
      .filter((name: unknown): name is string => typeof name === "string");

    expect(registered).toContain("skill_validate");
    expect(registered).toContain("skill_persist");
    // The existing toolset still registers alongside the new pair.
    expect(registered).toContain("spawn_agent");
    expect(registered).toContain("set_flow_param");
  });

  it("returns passed:false from the registered skill_validate for a malformed fixture", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    const tool = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as { name?: string; execute?: unknown })
      .find((t) => t.name === "skill_validate");
    expect(tool).toBeDefined();

    const result = await (
      tool!.execute as (
        id: string,
        params: object,
      ) => Promise<{ content: { type: string; text: string }[] }>
    )("e2e-validate-1", { path: join(sandbox, "fixtures", "bad-skill") });
    const text = result.content.map((c) => c.text).join("\n");
    expect(text).toContain("[error]");
    expect(text).toContain("passed: false");
  });

  it("activates the init-context and nudge extensions in a root session only", async () => {
    // Root boot (no FORGE_PARENT_SOCKET): both session extensions register.
    const rootPi = makeMockPi();
    await bootExtension(rootPi);
    const rootEvents = (rootPi.on as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(rootEvents).toContain("agent_settled");
    expect(rootEvents).toContain("session_compact");

    // Child boot (FORGE_PARENT_SOCKET set): neither may register — children
    // inherit the parent's context and must not inject or nudge.
    const supervisor = { spawnGuest: vi.fn(), mountInSession: vi.fn() };
    const server = new ParentSocketServer(supervisor as never, makeMockPi(), makeMockSpecManager());
    const socketPath = await server.start();
    try {
      process.env.FORGE_PARENT_SOCKET = socketPath;
      const childPi = makeMockPi();
      await bootExtension(childPi);
      const childEvents = (childPi.on as ReturnType<typeof vi.fn>).mock.calls.map(
        (call: unknown[]) => call[0],
      );
      expect(childEvents).not.toContain("agent_settled");
      expect(childEvents).not.toContain("session_compact");

      // Tools still register in child sessions — the guard only scopes the
      // session extensions, not the toolset.
      const childTools = (childPi.registerTool as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => (call[0] as { name?: string }).name)
        .filter((name: unknown): name is string => typeof name === "string");
      expect(childTools).toContain("skill_validate");
      expect(childTools).toContain("skill_persist");
    } finally {
      delete process.env.FORGE_PARENT_SOCKET;
      await server.stop();
    }
  });
});

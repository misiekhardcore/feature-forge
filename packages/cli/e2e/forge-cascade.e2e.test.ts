/**
 * End-to-end cascade test for the layered agent/flow discovery at the
 * composition root.
 *
 * Boots the real feature-forge extension (packages/cli/src/index.ts) inside
 * a sandboxed temp git repo whose project `.forge/` is scaffolded minimally,
 * with `HOME` stubbed at a temp dir carrying a GLOBAL `.forge/` scaffold.
 * The packaged default layer resolves from the repo's own install layout
 * (core/src in-process). The boot then exercises the unified first-wins
 * asset cascade:
 *
 *   [config specDirectories extras, project home, global home, packaged]
 *
 * and this test asserts on the exact pi registration surface that the
 * cascade produced:
 *
 * - the project copy of a same-named probe flow claims the name (nearest
 *   wins) - registered exactly once with the project copy's content, and
 *   the global copy's duplicate is never registered
 * - a flow unique to the global home still registers (the global layer is
 *   discovered and fills the gap); that flow references a spec id only the
 *   global agents dir declares, so its registration proves the global
 *   agent-spec layer loaded too
 * - packaged flows (e.g. `implement`) register even though neither the
 *   sandbox project nor the global home defines them
 * - the extension fully boots: no degraded-mode forge_notice is sent
 * - the registered `resources_discover` handler contributes the skill
 *   cascade: a skill declared in both the project and global layers is
 *   contributed from the project copy only (nearest wins), while a skill
 *   unique to the global layer still fills the gap
 *
 * The boot is in-process (like skill-tools.e2e.test.ts): a mock ExtensionAPI
 * records registerCommand/registerTool/on/sendMessage, exercising the
 * composition-root wiring end to end without a model or TUI.
 *
 * Prerequisites: none beyond the repo (the packaged probe resolves the core
 * source layout); the child-mode server check needs no `pi` CLI on PATH.
 */

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import featureForgeExtension from "../src/index";
import { makeMockPi } from "../src/test-utils";

const CLI_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = join(CLI_ROOT, "..", "..");
const FORGE_CONFIG_SOURCE = join(REPO_ROOT, ".forge", "config.json");

/** Current flow-schema URL - flow.json fixtures must carry it verbatim. */
const FLOW_SCHEMA_URL =
  "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/core/src/flows/flow-schema.json";

/** Minimal declarative spec for the sandbox project agents dir. */
const PROJECT_AGENT_SPEC = `---
id: "e2e-cascade-local"
role: "e2e-cascade-local"
tools: ["read"]
---

E2E cascade sandbox agent spec.
`;

/** Spec unique to the global agents dir - the global-only flow references it. */
const GLOBAL_AGENT_SPEC = `---
id: "global-spec-agent"
role: "global-spec-agent"
tools: ["read"]
---

Global home agent spec.
`;

/** SKILL.md path of the winning copies the resources_discover assertion expects. */
let projectProbeSkill: string;
let globalProbeSkill: string;
let globalOnlySkill: string;
/** Nested project-layer probe (grouping dir without a direct SKILL.md). */
let projectNestedSkill: string;
/** Packaged nested review skill - the bundled tree groups it under review/*. */
const PACKAGED_REVIEW_SKILL = join(
  REPO_ROOT,
  "packages",
  "core",
  "src",
  "skills",
  "review",
  "architecture",
  "SKILL.md",
);

/** Declarative orchestrator persona for a flow fixture (id must match flow.json). */
function orchestratorMd(id: string, note: string): string {
  return `---
id: "${id}"
role: "orchestrator"
tools:
  - read
---

${note}
`;
}

interface FlowFixture {
  name: string;
  command: string;
  orchestrator: string;
  description: string;
  routines: unknown[];
}

function flowJson(fixture: FlowFixture): string {
  return `${JSON.stringify(
    {
      $schema: FLOW_SCHEMA_URL,
      name: fixture.name,
      command: fixture.command,
      description: fixture.description,
      orchestrator: { systemPrompt: fixture.orchestrator },
      routines: fixture.routines,
    },
    null,
    2,
  )}\n`;
}

function writeFlowDir(flowsRoot: string, fixture: FlowFixture, personaNote: string): void {
  const dir = join(flowsRoot, fixture.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "flow.json"), flowJson(fixture));
  writeFileSync(join(dir, "orchestrator.md"), orchestratorMd(fixture.orchestrator, personaNote));
}

/**
 * Write a skill directory into a forge skills root; returns its SKILL.md path.
 * The frontmatter name equals the directory basename (see
 * {@link SkillResolver.resolveSkillName}); the description distinguishes
 * same-named copies across layers for fixture readability.
 */
function writeSkill(skillsRoot: string, dirName: string, description: string): string {
  const dir = join(skillsRoot, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: "${dirName}"\ndescription: "${description}"\n---\n`,
  );
  return join(dir, "SKILL.md");
}

let sandbox: string;
let globalHome: string;
let originalHome: string | undefined;
let originalCwd: string;

/**
 * Scaffold a temp git repo with a minimal project `.forge/` plus a stubbed
 * HOME containing a global `.forge/` scaffold, so the real extension boots
 * with all three asset layers present.
 */
function scaffoldSandbox(): void {
  sandbox = mkdtempSync(join(tmpdir(), "forge-cascade-project-"));
  execSync("git init --initial-branch=main", { cwd: sandbox, stdio: "ignore" });
  execSync('git config user.email "test@forge.local"', { cwd: sandbox, stdio: "ignore" });
  execSync('git config user.name "Forge E2E"', { cwd: sandbox, stdio: "ignore" });
  writeFileSync(join(sandbox, "README.md"), "# e2e sandbox\n");
  execSync("git add README.md", { cwd: sandbox, stdio: "ignore" });
  execSync('git commit -m "initial"', { cwd: sandbox, stdio: "ignore" });

  // Global home scaffold (stubbed HOME): agents + flows + skills; no config
  // file, so the config load never merges a second config layer.
  globalHome = mkdtempSync(join(tmpdir(), "forge-cascade-home-"));
  mkdirSync(join(globalHome, ".forge", "agents"), { recursive: true });
  mkdirSync(join(globalHome, ".forge", "flows"), { recursive: true });
  writeFileSync(join(globalHome, ".forge", "agents", "global-spec-agent.md"), GLOBAL_AGENT_SPEC);
  // Duplicate "probe" (same dir name as the project copy): must LOSE to the
  // nearer project layer even though it sits earlier only in global order.
  writeFlowDir(
    join(globalHome, ".forge", "flows"),
    {
      name: "probe",
      command: "/probe",
      orchestrator: "probe-orchestrator",
      description: "GLOBAL probe copy",
      routines: [{ id: "global_probe_step", params: [], steps: [] }],
    },
    "Global probe persona",
  );
  // Flow unique to the global layer; its routine references the spec the
  // global agents dir declares, tying flow registration to the agent
  // cascade (the flow only loads if global-spec-agent is registered).
  writeFlowDir(
    join(globalHome, ".forge", "flows"),
    {
      name: "global-only",
      command: "/global-only",
      orchestrator: "global-only-orchestrator",
      description: "global-only flow",
      routines: [
        {
          id: "global_only_step",
          params: [],
          steps: [
            {
              type: "agent",
              id: "use_global_spec",
              systemPrompt: "global-spec-agent",
              prompt: "Run with the global spec",
            },
          ],
        },
      ],
    },
    "Global-only persona",
  );

  // Project .forge: the tracked repo config (schema-valid, boots exactly
  // like a dev checkout), a project agent spec, and the nearest probe copy.
  mkdirSync(join(sandbox, ".forge", "agents"), { recursive: true });
  mkdirSync(join(sandbox, ".forge", "flows"), { recursive: true });
  cpSync(FORGE_CONFIG_SOURCE, join(sandbox, ".forge", "config.json"));
  writeFileSync(join(sandbox, ".forge", "agents", "e2e-cascade-local.md"), PROJECT_AGENT_SPEC);
  writeFlowDir(
    join(sandbox, ".forge", "flows"),
    {
      name: "probe",
      command: "/probe",
      orchestrator: "probe-orchestrator",
      description: "PROJECT probe copy",
      routines: [{ id: "project_probe_step", params: [], steps: [] }],
    },
    "Project probe persona",
  );

  // Skills: the nearest-wins cascade the resources_discover handler
  // contributes. "cascade-probe" exists in BOTH layers (the project copy
  // must win); "global-only-skill" exists only in the global home (the
  // global layer must fill the gap).
  projectProbeSkill = writeSkill(
    join(sandbox, ".forge", "skills"),
    "cascade-probe",
    "PROJECT cascade-probe copy",
  );
  globalProbeSkill = writeSkill(
    join(globalHome, ".forge", "skills"),
    "cascade-probe",
    "GLOBAL cascade-probe copy",
  );
  globalOnlySkill = writeSkill(
    join(globalHome, ".forge", "skills"),
    "global-only-skill",
    "global-only skill copy",
  );
  // A grouping-directory skill in the project layer (the review/* layout):
  // no direct SKILL.md in the group dir, so a one-level scan would miss it.
  projectNestedSkill = writeSkill(
    join(sandbox, ".forge", "skills", "review"),
    "project-nested",
    "PROJECT nested probe copy",
  );
}

/** Boot the real extension factory against the sandbox; returns the mock pi. */
async function bootExtension(pi: ReturnType<typeof makeMockPi>): Promise<void> {
  await featureForgeExtension(pi);
}

interface RegisteredCommand {
  name: string;
  description: string;
  flow?: { name?: string; description?: string };
}

function registeredCommands(pi: ReturnType<typeof makeMockPi>): RegisteredCommand[] {
  return (
    (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      Record<string, unknown>,
    ][]
  ).map(([name, options]) => ({
    name,
    description: options.description as string,
    flow: options.flow as { name?: string; description?: string } | undefined,
  }));
}

function findCommand(pi: ReturnType<typeof makeMockPi>, name: string): RegisteredCommand[] {
  return registeredCommands(pi).filter((command) => command.name === name);
}

interface RegisteredTool {
  name: string;
  description: string;
}

function registeredTools(pi: ReturnType<typeof makeMockPi>): RegisteredTool[] {
  return (
    (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls as [Record<string, unknown>][]
  ).map(([tool]) => ({
    name: tool.name as string,
    description: tool.description as string,
  }));
}

describe("agent + flow discovery cascade (e2e)", () => {
  beforeAll(() => {
    scaffoldSandbox();
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
    process.env.HOME = globalHome;
    process.chdir(sandbox);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
    if (globalHome) rmSync(globalHome, { recursive: true, force: true });
  });

  it("registers the project probe flow once with the project copy winning the cascade", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    // The probe exists in BOTH the project and global layers; only one
    // forge:probe may register (dedupe) and it must be the project copy.
    const probeCommands = findCommand(pi, "forge:probe");
    expect(probeCommands).toHaveLength(1);
    expect(probeCommands[0].description).toBe("Run the probe orchestrator workflow");
    // The registered flow object is the PROJECT copy (distinct description).
    expect(probeCommands[0].flow?.description).toBe("PROJECT probe copy");
    expect(probeCommands[0].flow?.name).toBe("probe");

    // Content-level nearest-wins check via the routine tools: the project
    // copy's routine registered, the global copy's routine did not.
    const tools = registeredTools(pi);
    expect(tools.filter((tool) => tool.name === "project_probe_step")).toHaveLength(1);
    expect(tools.filter((tool) => tool.name === "global_probe_step")).toHaveLength(0);
  });

  it("registers flows unique to the global layer (and proves the global agent layer loaded)", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    // global-only lives only in the global home. Its routine references the
    // global-spec-agent spec (declared only in the global agents dir), so a
    // successful registration proves BOTH global layers were discovered.
    const globalOnly = findCommand(pi, "forge:global-only");
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0].description).toBe("Run the global-only orchestrator workflow");
    const tools = registeredTools(pi);
    expect(tools.some((tool) => tool.name === "global_only_step")).toBe(true);
  });

  it("registers packaged-layer flows that neither the project nor the global home defines", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    // The packaged default layer (resolved from the in-process core source
    // layout) contributes flows no sandbox layer declares.
    expect(findCommand(pi, "forge:implement")).toHaveLength(1);
    const names = registeredCommands(pi).map((command) => command.name);
    expect(names).toContain("forge:implement");
    expect(names).toContain("forge:review");
    expect(names).toContain("forge:verify");
  });

  it("boots fully - no degraded-mode forge_notice is sent", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    // A full boot registers the orchestration surface; degraded mode would
    // register only forge:init and send a forge_notice on session_start.
    const notices = (
      (pi.sendMessage as ReturnType<typeof vi.fn>).mock.calls as [{ customType?: string }][]
    ).filter(([message]) => message.customType === "forge_notice");
    expect(notices).toHaveLength(0);
    expect(registeredCommands(pi).some((command) => command.name === "forge:probe")).toBe(true);
  });

  it("contributes the forge skill cascade to resources_discover (project copy wins, global fills gaps)", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    // The booted extension registers a resources_discover handler that
    // contributes one winning SKILL.md FILE path per skill name across the
    // [project, global, packaged] skill roots (see forge-skills.ts) - pi's
    // skill loader then resolves names from those paths nearest-first.
    const discoverHandler = (
      (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, (...args: unknown[]) => unknown][]
    ).find(([event]) => event === "resources_discover")?.[1];
    expect(discoverHandler).toBeDefined();

    const result = (await discoverHandler!("resources_discover", {})) as {
      skillPaths?: string[];
    };
    expect(result.skillPaths).toBeDefined();

    // cascade-probe exists in both the project and global layers: only the
    // project (nearest) copy's SKILL.md path may be contributed, and the
    // global copy's path must not shadow or duplicate it.
    expect(result.skillPaths).toContain(projectProbeSkill);
    expect(result.skillPaths).not.toContain(globalProbeSkill);

    // global-only-skill exists only in the global home: the global layer
    // fills the gap, so its SKILL.md path is contributed.
    expect(result.skillPaths).toContain(globalOnlySkill);
  });

  it("discovers skills nested in grouping directories (project group + packaged review/*)", async () => {
    const pi = makeMockPi();
    await bootExtension(pi);

    const discoverHandler = (
      (pi.on as ReturnType<typeof vi.fn>).mock.calls as [string, (...args: unknown[]) => unknown][]
    ).find(([event]) => event === "resources_discover")?.[1];
    expect(discoverHandler).toBeDefined();

    const result = (await discoverHandler!("resources_discover", {})) as {
      skillPaths?: string[];
    };
    expect(result.skillPaths).toBeDefined();

    // The project-layer skill lives under a grouping directory (review/*
    // style, no direct SKILL.md in the group): the recursive scan must
    // surface its SKILL.md path.
    expect(result.skillPaths).toContain(projectNestedSkill);

    // The packaged layer ships the review/* family nested under
    // skills/review/* - the real shipped layout a one-level scan dropped.
    // The cascade must contribute the winning (only) copy of each.
    expect(existsSync(PACKAGED_REVIEW_SKILL)).toBe(true);
    expect(result.skillPaths).toContain(PACKAGED_REVIEW_SKILL);
    expect(result.skillPaths).toContain(
      join(REPO_ROOT, "packages", "core", "src", "skills", "review", "security", "SKILL.md"),
    );
  });
});

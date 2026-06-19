# PLAN: Sub-agent orchestration with shared PiSpawner

## Goal

Replace the LLM-as-coordinator pattern (coordinator.md sent to main agent) with
pure TypeScript orchestration. The `/implement` phase becomes a loop in code that
spawns `pi -p` subprocesses for each sub-agent (build → review → verify → PR).
The `define` phase also gets refactored to use the same `PiSpawner` instead of
temp files + `execSync`.

## Architecture

```
.pi/extensions/feature-forge/
├── pi-spawner.ts              ← NEW: shared pi -p process spawner
├── state.ts / github.ts        ← unchanged
├── index.ts                    ← unchanged (composition point)
├── phases/
│   ├── define/
│   │   ├── index.ts            ← REFACTOR: use PiSpawner instead of tmpfiles
│   │   ├── prompts/main.md     ← unchanged
│   │   └── agents/research.md  ← unchanged
│   └── implement/
│       ├── index.ts            ← REFACTOR: no coordinator prompt, wire coordinator
│       ├── coordinator.ts      ← NEW: ImplementCoordinator — cycle loop
│       ├── agents/
│       │   ├── types.ts        ← NEW: SubAgentContext, SubAgentResult interfaces
│       │   ├── base.ts         ← NEW: SubAgent abstract base class
│       │   ├── build.ts        ← NEW: BuildAgent
│       │   ├── review.ts       ← NEW: ReviewAgent
│       │   ├── verify.ts       ← NEW: VerifyAgent
│       │   └── pr.ts           ← NEW: PrAgent
│       ├── agents/             ← existing .md prompt files
│       │   ├── build.md        ← ADD ## Result section
│       │   ├── review.md       ← ADD ## Result section
│       │   ├── verify.md       ← ADD ## Result section
│       │   └── pr.md           ← ADD ## Result section
│       └── prompts/
│           └── coordinator.md  ← DELETE (no longer used)
```

## Implementation Order

### Step 1: PiSpawner

**File:** `.pi/extensions/feature-forge/pi-spawner.ts`

- [x] Resolve pi binary (package root via `import.meta.resolve`, fallback to PATH)
- [x] `run(prompt, options?)` method:
  - spawns `pi -p <prompt>` as a child process
  - captures stdout via pipe
  - supports `cwd`, `timeout`, `env`, `signal` options
  - returns `{ stdout: string; exitCode: number }`
  - rejects on spawn error, resolves with exit code on completion
- [x] Expose `PiSpawner` class and `PiSpawnResult` type

### Step 2: Agent prompt updates

**Files:** `phases/implement/agents/*.md`

- [x] Already have `## Handoff` sections — no changes needed
- [x] Template variables (`{{issueUrl}}`, `{{worktreePath}}`, etc.) already in place

### Step 3: SubAgent base + types

**Files:** `phases/implement/agents/types.ts`, `phases/implement/agents/base.ts`

- [x] `SubAgentContext` interface
- [x] `SubAgentResult` interface
- [x] `SubAgent` abstract class:
  - `abstract name: string`
  - `abstract promptFile: string`
  - `constructor(promptDir: string, spawner: PiSpawner)`
  - `execute(ctx: SubAgentContext) → Promise<SubAgentResult>`
    - loads prompt from `this.promptDir / this.promptFile`
    - replaces `{{issueRef}}`, `{{cycleNumber}}`, `{{worktreePath}}`, etc.
    - calls `this.spawner.run(prompt, { cwd })`
    - calls `this.parseResult(stdout, exitCode)`
  - `parseResult(stdout, exitCode) → SubAgentResult`
    - extracts `## Handoff` section from stdout

### Step 4: Concrete agents

**Files:** `phases/implement/agents/build.ts`, `review.ts`, `verify.ts`, `pr.ts`

- [x] `BuildAgent` — promptFile = "build.md", extracts worktreePath, branch, summary
- [x] `ReviewAgent` — promptFile = "review.md", extracts findings, status
- [x] `VerifyAgent` — promptFile = "verify.md", extracts remainingIssues, status
- [x] `PrAgent` — promptFile = "pr.md", extracts prUrl

### Step 5: ImplementCoordinator

**File:** `phases/implement/coordinator.ts`

- [x] `ImplementCoordinator` class:
  - `constructor(issueRef: string, spawner: PiSpawner, agents: { build, review, verify, pr })`
  - `run(ui?) → Promise<{ prUrl?: string }>`
  - Cycle loop (max 5):
    1. Build → context: { issueRef, cycleNumber, previousFindings? }
       - capture worktreePath, branch from result
    2. Review → context: { issueRef, cycleNumber, worktreePath, branch }
       - capture findings from result
    3. Verify → context: { issueRef, cycleNumber, worktreePath, branch, reviewFindings }
       - if status === "pass", break loop
       - if status === "fail", set previousFindings, continue
  - After loop: PR → context: { issueRef, worktreePath, branch }
    - capture prUrl, return

### Step 6: Refactor ImplementPhase

**File:** `phases/implement/index.ts`

- [x] Remove coordinator prompt loading and sending to LLM
- [x] Handler creates `PiSpawner`, `ImplementCoordinator`, runs it
- [x] Reports progress via `ctx.ui.notify()`
- [x] Calls `State.getInstance().resolveIssueRef(args, sessionEntries)`

### Step 7: Refactor DefinePhase

**File:** `phases/define/index.ts`

- [x] Replace `writeFileSync` + `execSync` + `unlinkSync` pattern with `PiSpawner.run()`
- [x] Import `PiSpawner` from `../../pi-spawner` instead of `child_process`

### Step 8: Delete coordinator.md

**File:** `phases/implement/prompts/coordinator.md`

- [x] Remove file (no longer needed — logic lives in `coordinator.ts`)

### Step 9: Tests

- [ ] `test/phases/implement/agents/base.test.ts` — SubAgent.parseResult, buildPrompt
- [ ] `test/phases/implement/agents/build.test.ts` — BuildAgent
- [ ] `test/phases/implement/agents/review.test.ts` — ReviewAgent
- [ ] `test/phases/implement/agents/verify.test.ts` — VerifyAgent
- [ ] `test/phases/implement/agents/pr.test.ts` — PrAgent
- [ ] `test/phases/implement/coordinator.test.ts` — cycle loop logic
- [ ] `test/pi-spawner.test.ts` — spawn, error handling, timeout
- [ ] Update `test/phases/define.test.ts` — mock PiSpawner instead of fs/child_process

### Step 10: Full check

- [ ] `npm run check` — lint, format, 0 TS errors, all tests pass

---

## Key decisions

- **No coordinator prompt.** The loop is pure TypeScript with `for`/`if`/`break`.
- **Each sub-agent gets full tool access.** `pi -p` spawns a fresh pi session with
  bash, read, write, edit tools — the agent can read files, check tests, create
  commits, open PRs.
- **Structured handoff via `## Result` section.** Each agent prompt includes a
  `## Result` section with fields the agent fills in. The parseResult method
  extracts these fields from stdout.
- **Shared PiSpawner.** One class, used by both define and implement phases.
  Replaces execSync + temp files with spawn + pipe.
- **Dependency injection.** ImplementCoordinator receives spawner and agents via
  constructor — easy to test with mock spawner.

import type { BeforeAgentStartEventResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Always-on context block injected once per session in the root session
 * (agents-memo INIT.md pattern): forge capabilities plus the create-skill
 * self-improvement policy. Content approved verbatim (CREATE-SKILL-PLAN.md
 * §9) — do not reword.
 */
export const FORGE_INIT_CONTEXT = `[feature-forge: session init]
# feature-forge - session init

This session runs the feature-forge extension: forge flows (/forge:*), sub-agent
routines, worktree management, and the forge toolset (skills: /skill:forge-build,
/skill:forge-verify, ...; tools: create_workspace, run_build_loop, spawn_agent, ...).

## When to engage forge
- The user invokes a /forge:* command or asks to run a flow - follow the active flow
  file and drive its routine tools.
- The user asks to plan, build, review, verify, or open a PR for an issue - offer the
  matching flow instead of improvising.
- Work needs an isolated git worktree - use the workspace routines.

## Skill self-improvement policy
feature-forge carries a meta-skill: create-skill, backed by the skill_validate and
skill_persist tools. When a procedure recurs - the 2nd time you do something
non-trivial, or you re-research a topic already solved - opportunistically create or
extend a skill instead of repeating ad-hoc work.
- Default scope: project skill at <repo>/.pi/skills/, committed with the current work,
  no confirmation needed.
- Global skills (~/.forge/skills default, ~/.pi/agent/skills when machine-synced via
  pi-config is wanted): propose, but write only after the user confirms.
- Search first: all skill names + descriptions are listed at session start. Extend an
  existing skill on overlap; one home per capability - never duplicate.
- Validate before declaring done: follow the structure mandate and run skill_validate.

## When NOT to engage forge
One-off work with no repetition, or no flow requested - do not invent forge ceremony,
spawn sub-agents, or create worktrees unasked. Skills encode the HOW of recurring
work; they do not replace answering the question.
`;

const INIT_CUSTOM_TYPE = "forge_init_context";

const initMessage = {
  customType: INIT_CUSTOM_TYPE,
  content: [{ type: "text" as const, text: FORGE_INIT_CONTEXT }],
  display: false,
};

/**
 * Register the once-per-session init-context injection.
 *
 * `before_agent_start` fires once per prompt, not once per session, so a
 * session-scoped latch limits injection to the first prompt. The latch is
 * flipped via setImmediate (agents-memo technique) so every handler of the
 * first prompt's emit still sees the un-served flag. Compaction drops the
 * injected context, so `session_compact` re-injects it.
 *
 * Module state is fresh per closure (process boot, extension /reload), so
 * the latch starts UNSEEDED and the first `session_start` observed in the
 * closure picks the initial value from its reason: `reload`/`resume`/`fork`
 * open an existing transcript whose persisted init entry (customType
 * forge_init_context) is already replayed into LLM context, so the latch
 * starts closed and no duplicate is injected; `startup`/`new` have no
 * persisted entry, so it starts open. Later session_starts reopen the latch
 * for fresh sessions (`startup`/`new`) only - the same gate the seed uses.
 *
 * Coverage note: a process restart into an existing transcript reports
 * reason "startup" (boot-continue) and cannot be told apart from a
 * genuinely fresh boot, so it still injects one duplicate per boot;
 * closing that hole needs a transcript scan for the persisted entry
 * (recorded follow-up).
 */
export function activateForgeInitContext(pi: ExtensionAPI): void {
  let injected = false;
  let seeded = false;

  const isFirstPrompt = (): boolean => {
    if (injected) return false;
    // All handlers of one emit complete within the current task; flip the
    // latch only afterwards so no handler of the first prompt sees it set.
    setImmediate(() => {
      injected = true;
    });
    return true;
  };

  pi.on("before_agent_start", (_event, _ctx): BeforeAgentStartEventResult | void => {
    if (!isFirstPrompt()) return;
    return { message: initMessage };
  });

  pi.on("session_compact", () => {
    pi.sendMessage(initMessage, { triggerTurn: false });
  });

  pi.on("session_start", (event) => {
    const fresh = event.reason === "startup" || event.reason === "new";
    if (!seeded) {
      // Seed the latch from the first start reason observed in this closure
      // (its module state is fresh): reload/resume/fork re-open a transcript
      // whose entry is already persisted, so start closed - a fresh
      // startup/new has no persisted entry, so start open.
      seeded = true;
      injected = !fresh;
      return;
    }
    if (fresh) {
      injected = false;
    }
  });
}

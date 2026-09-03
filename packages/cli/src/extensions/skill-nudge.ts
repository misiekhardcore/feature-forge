import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ActiveFlowRegistry } from "@feature-forge/core/flows";

/**
 * Once-per-session wrap-up prompt asking the agent whether any procedure
 * repeated or required re-research this session, and if so to capture it as
 * a project skill via the create-skill meta-skill. Exported for tests.
 */
export const SKILL_NUDGE_PROMPT =
  "Session wrap-up (forge): did any procedure repeat this session or require " +
  "re-research (commands, configs, gotchas)? If yes, load and follow " +
  "/skill:create-skill to capture it as a project skill, then reply in one short " +
  "line with what you created. If no, reply exactly: no skill-worthy pattern.";

/**
 * Register the session wrap-up skill nudge.
 *
 * Fires on `agent_settled` once per session. Timing: pi emits
 * `agent_settled` at the end of EVERY prompt run and interactive mode has no
 * end-of-session signal, so the once-per-session nudge lands after the
 * session's FIRST completed turn, not at a true session end - the accepted
 * trade-off of the approved always-on design (the flow guard below keeps it
 * silent mid-flow). Turn-counting heuristics are an explicit non-goal.
 *
 * The once-per-session latch is re-armed on `session_start` ONLY for fresh
 * sessions (`startup`/`new`): an in-process /resume or /fork of a transcript
 * that was already nudged in this process keeps the latch closed, so the
 * wrap-up prompt is not re-sent on the next settle. Fresh closures without
 * transcript inspection (process restart into an existing transcript,
 * extension /reload) cannot tell whether that transcript was already nudged,
 * so one duplicate nudge per such closure is possible - transcript
 * inspection is a recorded follow-up.
 *
 * The nudge stays silent while a forge flow is mounted - the registry store
 * is set from the flow's first command until a successful `/flow:exit` - and
 * the latch is left open in that case so a later non-flow settle still fires
 * it. Sent with `deliverAs: "followUp"` per the merged #252 fix: harmless
 * when idle, queued when the agent is mid-turn.
 */
export function activateSkillNudge(pi: ExtensionAPI, activeFlow: ActiveFlowRegistry): void {
  let nudged = false;

  pi.on("session_start", (event) => {
    if (event.reason === "startup" || event.reason === "new") {
      nudged = false;
    }
  });

  pi.on("agent_settled", () => {
    if (nudged) return;
    // A mounted flow keeps the active-flow store set: a wrap-up nudge would
    // derail the running flow, so skip it without consuming the latch.
    if (activeFlow.getStore() !== undefined) return;
    nudged = true;
    pi.sendUserMessage(SKILL_NUDGE_PROMPT, { deliverAs: "followUp" });
  });
}

import { ActiveFlowRegistry, FlowStateStore } from "@feature-forge/core/flows";
import { describe, expect, it, vi } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateSkillNudge, SKILL_NUDGE_PROMPT } from "./skill-nudge";

type MockPi = ReturnType<typeof makeMockPiWithHandlers>;

function makePi(): MockPi {
  const pi = makeMockPiWithHandlers();
  pi.sendUserMessage = vi.fn();
  return pi;
}

/** Invoke the registered agent_settled handler. */
async function settle(pi: MockPi): Promise<void> {
  await pi.getHandler("agent_settled")!({ type: "agent_settled" }, {});
}

describe("activateSkillNudge", () => {
  it("registers agent_settled and session_start handlers", () => {
    const pi = makePi();
    activateSkillNudge(pi, new ActiveFlowRegistry());

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("agent_settled", expect.any(Function));
  });

  it("sends the wrap-up prompt once on the first settle with no active flow", async () => {
    const pi = makePi();
    activateSkillNudge(pi, new ActiveFlowRegistry());

    await settle(pi);

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendUserMessage).toHaveBeenCalledWith(SKILL_NUDGE_PROMPT, {
      deliverAs: "followUp",
    });
  });

  it("does not nudge again on later settles in the same session", async () => {
    const pi = makePi();
    activateSkillNudge(pi, new ActiveFlowRegistry());

    await settle(pi);
    await settle(pi);

    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("stays silent while a flow is active and keeps the latch open for a later non-flow settle", async () => {
    const pi = makePi();
    const registry = new ActiveFlowRegistry();
    activateSkillNudge(pi, registry);

    registry.setCurrent("test-flow", new FlowStateStore());
    await settle(pi);
    expect(pi.sendUserMessage).not.toHaveBeenCalled();

    registry.clear();
    await settle(pi);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it.each(["startup", "new"])(
    "re-arms the latch on a fresh session_start (%s) so the next session can nudge again",
    async (reason) => {
      const pi = makePi();
      activateSkillNudge(pi, new ActiveFlowRegistry());

      await settle(pi);
      await settle(pi);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

      await pi.getHandler("session_start")!({ type: "session_start", reason }, {});
      await settle(pi);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["resume", "fork"])(
    "does not re-arm the latch on an in-process session_start (%s) of an already-nudged transcript",
    async (reason) => {
      const pi = makePi();
      activateSkillNudge(pi, new ActiveFlowRegistry());

      await settle(pi);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);

      // Resume/fork loads a transcript that was already nudged in this
      // process - the wrap-up prompt must not be re-sent on its next settle.
      await pi.getHandler("session_start")!({ type: "session_start", reason }, {});
      await settle(pi);
      expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
    },
  );
});

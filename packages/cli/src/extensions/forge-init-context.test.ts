import type { BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateForgeInitContext, FORGE_INIT_CONTEXT } from "./forge-init-context";

type MockPi = ReturnType<typeof makeMockPiWithHandlers>;

function makePi(): MockPi {
  const pi = makeMockPiWithHandlers();
  pi.sendMessage = vi.fn();
  return pi;
}

/** Wait until the latch-flipping setImmediate from a handler call has run. */
function flushImmediates(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const expectedMessage = {
  customType: "forge_init_context",
  content: [{ type: "text", text: FORGE_INIT_CONTEXT }],
  display: false,
};

describe("activateForgeInitContext", () => {
  it("injects the init context as a hidden message on the first prompt of a session", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);

    const result = (await pi.getHandler("before_agent_start")!(
      { type: "before_agent_start" },
      {},
    )) as BeforeAgentStartEventResult | void;

    expect(result).toEqual({ message: expectedMessage });
  });

  it("does not inject again on subsequent prompts in the same session", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);
    const handler = pi.getHandler("before_agent_start")!;

    await handler({ type: "before_agent_start" }, {});
    await flushImmediates();

    const second = await handler({ type: "before_agent_start" }, {});
    expect(second).toBeUndefined();
  });

  it("re-injects the context after session_compact", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);

    await pi.getHandler("session_compact")!({ type: "session_compact" }, {});

    expect(pi.sendMessage).toHaveBeenCalledWith(expectedMessage, { triggerTurn: false });
  });

  it("resets the latch on a fresh session_start (startup/new) so the next session injects again", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);
    const handler = pi.getHandler("before_agent_start")!;

    await handler({ type: "before_agent_start" }, {});
    await flushImmediates();
    expect(await handler({ type: "before_agent_start" }, {})).toBeUndefined();

    await pi.getHandler("session_start")!({ type: "session_start", reason: "new" }, {});
    const afterReset = (await handler(
      { type: "before_agent_start" },
      {},
    )) as BeforeAgentStartEventResult | void;
    expect(afterReset).toEqual({ message: expectedMessage });
  });

  it("does not reset the latch on resume/fork so the persisted entry is not duplicated", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);
    const handler = pi.getHandler("before_agent_start")!;

    // Serve the first prompt of the original session.
    await handler({ type: "before_agent_start" }, {});
    await flushImmediates();

    // Resuming or forking loads a transcript that already contains the
    // injected entry - the latch must stay closed to avoid a duplicate.
    await pi.getHandler("session_start")!({ type: "session_start", reason: "resume" }, {});
    expect(await handler({ type: "before_agent_start" }, {})).toBeUndefined();

    await pi.getHandler("session_start")!({ type: "session_start", reason: "fork" }, {});
    expect(await handler({ type: "before_agent_start" }, {})).toBeUndefined();
  });

  it.each(["reload", "resume", "fork"])(
    "seeds the latch closed when the first session_start of a fresh closure is %s (entry already persisted)",
    async (reason) => {
      const pi = makePi();
      activateForgeInitContext(pi);
      const handler = pi.getHandler("before_agent_start")!;

      // Fresh module closure (extension /reload, restart into an existing
      // transcript): the first observed start reason must seed the latch
      // closed - the persisted forge_init_context entry is already replayed
      // into LLM context, so the first prompt must not inject a duplicate.
      await pi.getHandler("session_start")!({ type: "session_start", reason }, {});
      expect(await handler({ type: "before_agent_start" }, {})).toBeUndefined();
    },
  );

  it("seeds the latch open when the first session_start of a fresh closure is a new session", async () => {
    const pi = makePi();
    activateForgeInitContext(pi);
    const handler = pi.getHandler("before_agent_start")!;

    await pi.getHandler("session_start")!({ type: "session_start", reason: "new" }, {});
    const result = (await handler(
      { type: "before_agent_start" },
      {},
    )) as BeforeAgentStartEventResult | void;
    expect(result).toEqual({ message: expectedMessage });
  });

  it("exports the approved init-context content verbatim", () => {
    expect(
      FORGE_INIT_CONTEXT.startsWith(
        "[feature-forge: session init]\n# feature-forge - session init\n",
      ),
    ).toBe(true);
    expect(FORGE_INIT_CONTEXT).toContain("## Skill self-improvement policy");
    expect(FORGE_INIT_CONTEXT).toContain(
      "feature-forge carries a meta-skill: create-skill, backed by the skill_validate and\nskill_persist tools.",
    );
    expect(FORGE_INIT_CONTEXT).toContain("one home per capability - never duplicate.");
    expect(FORGE_INIT_CONTEXT).toContain("## When NOT to engage forge");
    expect(
      FORGE_INIT_CONTEXT.trimEnd().endsWith("they do not replace answering the question."),
    ).toBe(true);
  });
});

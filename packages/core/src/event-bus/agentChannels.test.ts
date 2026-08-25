import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../test-utils";
import {
  type AgentChannelEmitter,
  type AgentChannelEmitterLike,
  emitAgentDone,
  emitAgentStarted,
  emitAgentStream,
  type StringEmitBus,
} from "./agentChannels";

describe("agentChannels", () => {
  const startedParams = {
    executionId: "exec-1",
    agentId: "agent-1",
    name: "agent-1",
    label: "build",
  };
  const streamParams = {
    executionId: "exec-1",
    agentId: "agent-1",
    name: "agent-1",
    label: "build",
    event: { type: "turn_start" } as const,
  };
  const doneParams = {
    executionId: "exec-1",
    agentId: "agent-1",
    name: "agent-1",
  };

  it("accepts the TypedEventBus (typed emit signature)", () => {
    const bus = makeMockTypedEventBus();
    const emitter: AgentChannelEmitter = bus;
    expect(emitter).toBe(bus);
  });

  it("accepts a plain string/unknown emit bus (pi EventBus fallback shape)", () => {
    const bus = makeMockTypedEventBus().raw;
    const emitter: AgentChannelEmitter = bus;
    expect(emitter).toBe(bus);
    const like: AgentChannelEmitterLike = bus;
    expect(like).toBe(bus);
  });

  it("emits feature-forge:agent-started with the verbatim message and payload", () => {
    const bus = makeMockTypedEventBus();
    emitAgentStarted(bus, startedParams);

    expect(bus.raw.emit).toHaveBeenCalledTimes(1);
    expect(bus.raw.emit).toHaveBeenCalledWith("feature-forge:agent-started", {
      phase: "agent-started",
      message: `Agent "${startedParams.name}" (${startedParams.label}) started`,
      details: { executionId: "exec-1", agentId: "agent-1" },
    });
  });

  it("emits feature-forge:agent-stream with the verbatim message, label, and event", () => {
    const bus = makeMockTypedEventBus();
    emitAgentStream(bus, streamParams);

    expect(bus.raw.emit).toHaveBeenCalledTimes(1);
    expect(bus.raw.emit).toHaveBeenCalledWith("feature-forge:agent-stream", {
      phase: "agent-stream",
      message: `Agent "${streamParams.name}" stream event`,
      details: {
        executionId: "exec-1",
        agentId: "agent-1",
        label: "build",
        event: { type: "turn_start" },
      },
    });
  });

  it('emits feature-forge:agent-done with message "completed" when passed is not false', () => {
    const bus = makeMockTypedEventBus();
    emitAgentDone(bus, { ...doneParams, passed: true, summary: "all good" });

    expect(bus.raw.emit).toHaveBeenCalledTimes(1);
    expect(bus.raw.emit).toHaveBeenCalledWith("feature-forge:agent-done", {
      phase: "agent-done",
      message: `Agent "${doneParams.name}" completed`,
      details: {
        executionId: "exec-1",
        agentId: "agent-1",
        passed: true,
        summary: "all good",
      },
    });
  });

  it('emits feature-forge:agent-done with message "failed" iff passed === false', () => {
    const bus = makeMockTypedEventBus();
    emitAgentDone(bus, { ...doneParams, passed: false, summary: "nope" });

    expect(bus.raw.emit).toHaveBeenCalledTimes(1);
    expect(bus.raw.emit).toHaveBeenCalledWith("feature-forge:agent-done", {
      phase: "agent-done",
      message: `Agent "${doneParams.name}" failed`,
      details: {
        executionId: "exec-1",
        agentId: "agent-1",
        passed: false,
        summary: "nope",
      },
    });
  });

  it("emits agent-done as completed when passed is undefined (omitted)", () => {
    const bus = makeMockTypedEventBus();
    emitAgentDone(bus, doneParams);

    expect(bus.raw.emit).toHaveBeenCalledWith(
      "feature-forge:agent-done",
      expect.objectContaining({
        message: `Agent "${doneParams.name}" completed`,
        details: expect.objectContaining({ passed: undefined }),
      }),
    );
  });

  it("accepts a plain string/unknown emit bus and emits the same payload", () => {
    const emitSpy = vi.fn();
    const untypedBus: StringEmitBus = { emit: emitSpy };
    emitAgentStarted(untypedBus, startedParams);
    emitAgentStream(untypedBus, streamParams);
    emitAgentDone(untypedBus, { ...doneParams, passed: false });

    expect(emitSpy).toHaveBeenCalledTimes(3);
    expect(emitSpy).toHaveBeenNthCalledWith(1, "feature-forge:agent-started", {
      phase: "agent-started",
      message: `Agent "${startedParams.name}" (${startedParams.label}) started`,
      details: { executionId: "exec-1", agentId: "agent-1" },
    });
    expect(emitSpy).toHaveBeenNthCalledWith(2, "feature-forge:agent-stream", {
      phase: "agent-stream",
      message: `Agent "${streamParams.name}" stream event`,
      details: {
        executionId: "exec-1",
        agentId: "agent-1",
        label: "build",
        event: { type: "turn_start" },
      },
    });
    expect(emitSpy).toHaveBeenNthCalledWith(3, "feature-forge:agent-done", {
      phase: "agent-done",
      message: `Agent "${doneParams.name}" failed`,
      details: {
        executionId: "exec-1",
        agentId: "agent-1",
        passed: false,
        summary: undefined,
      },
    });
  });

  it("distinguishes name from agentId in the message", () => {
    const bus = makeMockTypedEventBus();
    emitAgentStarted(bus, {
      executionId: "exec-1",
      agentId: "agent-1",
      name: "instruction-7",
      label: "review",
    });

    expect(bus.raw.emit).toHaveBeenCalledWith(
      "feature-forge:agent-started",
      expect.objectContaining({
        message: `Agent "instruction-7" (review) started`,
        details: expect.objectContaining({ agentId: "agent-1" }),
      }),
    );
  });
});

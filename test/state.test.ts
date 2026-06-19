import { describe, it, expect } from "vitest";
import { findPipelineIssueUrl } from "../.pi/extensions/feature-forge/state";
import type { SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

function pipelineEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "pipeline-issue",
    data,
  };
}

describe("findPipelineIssueUrl", () => {
  it("returns undefined for empty entries", () => {
    expect(findPipelineIssueUrl([])).toBeUndefined();
  });

  it("returns undefined when no pipeline-issue entry exists", () => {
    const entries: SessionEntry[] = [{ type: "user", text: "hello" } as SessionEntry];
    expect(findPipelineIssueUrl(entries)).toBeUndefined();
  });

  it("returns the issueUrl from the last pipeline-issue entry", () => {
    const entries: SessionEntry[] = [
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/1" }),
    ];
    expect(findPipelineIssueUrl(entries)).toBe("https://github.com/o/r/issues/1");
  });

  it("returns the last entry when multiple pipeline-issue entries exist", () => {
    const entries: SessionEntry[] = [
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/1" }),
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/2" }),
    ];
    expect(findPipelineIssueUrl(entries)).toBe("https://github.com/o/r/issues/2");
  });

  it("returns undefined when pipeline-issue entry has no issueUrl", () => {
    const entries: SessionEntry[] = [pipelineEntry({ issueNumber: 42 })];
    expect(findPipelineIssueUrl(entries)).toBeUndefined();
  });

  it("ignores non-custom entries mixed in", () => {
    const entries: SessionEntry[] = [
      { type: "user", text: "hello" } as SessionEntry,
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/7" }),
      { type: "assistant", text: "ok" } as SessionEntry,
    ];
    expect(findPipelineIssueUrl(entries)).toBe("https://github.com/o/r/issues/7");
  });
});

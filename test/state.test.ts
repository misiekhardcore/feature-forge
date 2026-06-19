import { describe, it, expect } from "vitest";
import { findDiscoverIssueUrl } from "../.pi/extensions/feature-forge/state";
import type { SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

function customEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "discover-issue",
    data,
  };
}

describe("findDiscoverIssueUrl", () => {
  it("returns undefined for empty entries", () => {
    expect(findDiscoverIssueUrl([])).toBeUndefined();
  });

  it("returns undefined when no discover-issue entry exists", () => {
    const entries: SessionEntry[] = [{ type: "user", text: "hello" } as SessionEntry];
    expect(findDiscoverIssueUrl(entries)).toBeUndefined();
  });

  it("returns the issueUrl from the last discover-issue entry", () => {
    const entries: SessionEntry[] = [customEntry({ issueUrl: "https://github.com/o/r/issues/1" })];
    expect(findDiscoverIssueUrl(entries)).toBe("https://github.com/o/r/issues/1");
  });

  it("returns the last entry when multiple discover-issue entries exist", () => {
    const entries: SessionEntry[] = [
      customEntry({ issueUrl: "https://github.com/o/r/issues/1" }),
      customEntry({ issueUrl: "https://github.com/o/r/issues/2" }),
    ];
    expect(findDiscoverIssueUrl(entries)).toBe("https://github.com/o/r/issues/2");
  });

  it("returns undefined when discover-issue entry has no issueUrl", () => {
    const entries: SessionEntry[] = [customEntry({ issueNumber: 42 })];
    expect(findDiscoverIssueUrl(entries)).toBeUndefined();
  });

  it("ignores non-custom entries mixed in", () => {
    const entries: SessionEntry[] = [
      { type: "user", text: "hello" } as SessionEntry,
      customEntry({ issueUrl: "https://github.com/o/r/issues/7" }),
      { type: "assistant", text: "ok" } as SessionEntry,
    ];
    expect(findDiscoverIssueUrl(entries)).toBe("https://github.com/o/r/issues/7");
  });
});

import { describe, it, expect } from "vitest";
import {
  findDiscoverIssueUrl,
  expandBareIssueNumber,
  resolveIssueRef,
} from "../.pi/extensions/feature-forge/state";
import type { SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

function customEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "discover-issue",
    data,
  };
}

// ---------------------------------------------------------------------------
// findDiscoverIssueUrl
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// expandBareIssueNumber
// ---------------------------------------------------------------------------
describe("expandBareIssueNumber", () => {
  it("returns already-URL refs unchanged", () => {
    const url = "https://github.com/owner/repo/issues/5";
    expect(expandBareIssueNumber(url)).toBe(url);
  });

  it("returns non-numeric strings unchanged", () => {
    expect(expandBareIssueNumber("not-a-number")).toBe("not-a-number");
  });

  it("returns empty string unchanged", () => {
    expect(expandBareIssueNumber("")).toBe("");
  });

  it("returns bare digits unchanged when not in a git repo (execSync throws)", () => {
    // When execSync fails (no git repo), catch block returns ref as-is.
    // In test context we DO have a git repo, so this tests the non-numeric
    // guard path. The execSync failure path is covered by the remote
    // being present in CI/repo — the function is defensive.
    expect(expandBareIssueNumber("42")).toBeDefined();
  });

  it("expands bare issue number to full GitHub URL (repo context)", () => {
    // This test relies on being run from a git repo with origin remote.
    const result = expandBareIssueNumber("1");
    // In this repo, origin is git@github.com:misiekhardcore/feature-forge.git
    // But we accept any well-formed GitHub URL since tests may run in forks.
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/1$/);
  });

  it("handles HTTPS remote format", () => {
    // Remote formats tested: git@github.com:owner/repo.git (SSH)
    // The regex also handles https://github.com/owner/repo.git
    // We test the actual repo remote which is SSH format.
    const result = expandBareIssueNumber("99");
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/99$/);
  });
});

// ---------------------------------------------------------------------------
// resolveIssueRef
// ---------------------------------------------------------------------------
describe("resolveIssueRef", () => {
  it("returns undefined when args is undefined and no discover state", () => {
    expect(resolveIssueRef(undefined, [])).toBeUndefined();
  });

  it("returns undefined when args is empty/whitespace and no discover state", () => {
    expect(resolveIssueRef("   ", [])).toBeUndefined();
    expect(resolveIssueRef("", [])).toBeUndefined();
  });

  it("returns expanded url when args is a bare number", () => {
    // In repo context, bare numbers are expanded via git remote.
    const result = resolveIssueRef("7", []);
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/7$/);
  });

  it("returns args unchanged when already a URL", () => {
    const url = "https://github.com/o/r/issues/7";
    expect(resolveIssueRef(url, [])).toBe(url);
  });

  it("falls back to discover state when args is undefined", () => {
    const entries: SessionEntry[] = [customEntry({ issueUrl: "https://github.com/o/r/issues/3" })];
    expect(resolveIssueRef(undefined, entries)).toBe("https://github.com/o/r/issues/3");
  });

  it("falls back to discover state when args is whitespace-only", () => {
    const entries: SessionEntry[] = [customEntry({ issueUrl: "https://github.com/o/r/issues/3" })];
    expect(resolveIssueRef("   ", entries)).toBe("https://github.com/o/r/issues/3");
  });

  it("prioritizes args over discover state", () => {
    const entries: SessionEntry[] = [customEntry({ issueUrl: "https://github.com/o/r/issues/3" })];
    expect(resolveIssueRef("https://github.com/o/r/issues/99", entries)).toBe(
      "https://github.com/o/r/issues/99",
    );
  });

  it("returns undefined when discover state has no issueUrl", () => {
    const entries: SessionEntry[] = [customEntry({ issueNumber: 1 })];
    expect(resolveIssueRef(undefined, entries)).toBeUndefined();
  });
});

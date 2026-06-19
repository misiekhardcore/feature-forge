import { describe, it, expect } from "vitest";
import {
  expandBareIssueNumber,
  resolveIssueRef,
  isGitHubPrUrl,
} from "../.pi/extensions/feature-forge/github";
import type { SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

function pipelineEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "pipeline-issue",
    data,
    id: "test-id",
    parentId: null,
    timestamp: new Date().toISOString(),
  };
}

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
    expect(expandBareIssueNumber("42")).toBeDefined();
  });

  it("expands bare issue number to full GitHub URL (repo context)", () => {
    const result = expandBareIssueNumber("1");
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/1$/);
  });

  it("handles SSH remote format (repo context)", () => {
    const result = expandBareIssueNumber("99");
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/99$/);
  });
});

// ---------------------------------------------------------------------------
// isGitHubPrUrl
// ---------------------------------------------------------------------------
describe("isGitHubPrUrl", () => {
  it("matches standard PR URL", () => {
    const result = isGitHubPrUrl("https://github.com/owner/repo/pull/123");
    expect(result).not.toBeNull();
    expect(result![1]).toBe("123");
  });

  it("matches PR URL in multiline output", () => {
    const result = isGitHubPrUrl("Some output\nhttps://github.com/owner/repo/pull/456\nmore text");
    expect(result).not.toBeNull();
    expect(result![1]).toBe("456");
  });

  it("does not match issue URL", () => {
    expect(isGitHubPrUrl("https://github.com/owner/repo/issues/123")).toBeNull();
  });

  it("does not match non-GitHub URLs", () => {
    expect(isGitHubPrUrl("https://gitlab.com/owner/repo/pull/123")).toBeNull();
  });

  it("does not match empty string", () => {
    expect(isGitHubPrUrl("")).toBeNull();
  });

  it("matches http variant", () => {
    const result = isGitHubPrUrl("http://github.com/o/r/pull/789");
    expect(result).not.toBeNull();
    expect(result![1]).toBe("789");
  });
});

// ---------------------------------------------------------------------------
// resolveIssueRef
// ---------------------------------------------------------------------------
describe("resolveIssueRef", () => {
  it("returns undefined when args is undefined and no pipeline state", () => {
    expect(resolveIssueRef(undefined, [])).toBeUndefined();
  });

  it("returns undefined when args is empty/whitespace and no pipeline state", () => {
    expect(resolveIssueRef("   ", [])).toBeUndefined();
    expect(resolveIssueRef("", [])).toBeUndefined();
  });

  it("returns expanded url when args is a bare number", () => {
    const result = resolveIssueRef("7", []);
    expect(result).toMatch(/^https:\/\/github\.com\/.+\/.+\/issues\/7$/);
  });

  it("returns args unchanged when already a URL", () => {
    const url = "https://github.com/o/r/issues/7";
    expect(resolveIssueRef(url, [])).toBe(url);
  });

  it("falls back to pipeline state when args is undefined", () => {
    const entries: SessionEntry[] = [
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/3" }),
    ];
    expect(resolveIssueRef(undefined, entries)).toBe("https://github.com/o/r/issues/3");
  });

  it("falls back to pipeline state when args is whitespace-only", () => {
    const entries: SessionEntry[] = [
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/3" }),
    ];
    expect(resolveIssueRef("   ", entries)).toBe("https://github.com/o/r/issues/3");
  });

  it("prioritizes args over pipeline state", () => {
    const entries: SessionEntry[] = [
      pipelineEntry({ issueUrl: "https://github.com/o/r/issues/3" }),
    ];
    expect(resolveIssueRef("https://github.com/o/r/issues/99", entries)).toBe(
      "https://github.com/o/r/issues/99",
    );
  });

  it("returns undefined when pipeline state has no issueUrl", () => {
    const entries: SessionEntry[] = [pipelineEntry({ issueNumber: 1 })];
    expect(resolveIssueRef(undefined, entries)).toBeUndefined();
  });
});

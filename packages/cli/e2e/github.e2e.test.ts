/**
 * E2E tests for the github module against the real gh CLI.
 *
 * The unit tests in src/github.test.ts mock child_process, which cannot catch
 * gh contract drift (e.g. a `--json` field name gh rejects at runtime, or a
 * GraphQL query gh refuses to run). These tests exercise the real `gh` binary
 * to validate the field list and round-trip the public functions.
 *
 * Skipped when `gh` is not installed or not authenticated.
 *
 * Run via: `npm run test:e2e` (also included in the root `npm run test`).
 */

import { execFileSync, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { getPullRequest, getUnresolvedComments } from "../src/github";

// ── gh availability guard ──────────────────────────────────────────────────

function ghReady(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Mirrors the exact `--json` field list used by `getPullRequest`. */
const PR_VIEW_JSON_FIELDS = "number,title,url,headRefName,headRepository";

interface OpenPr {
  owner: string;
  repo: string;
  number: number;
}

/** Find any real PR in the current repo to round-trip against, if one exists. */
function findAnyPr(): OpenPr | null {
  try {
    const nwo = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
      encoding: "utf8",
    }).trim();
    const [owner, repo] = nwo.split("/");
    const list = execFileSync(
      "gh",
      ["pr", "list", "--repo", nwo, "--state", "all", "--limit", "1", "--json", "number"],
      { encoding: "utf8" },
    );
    const prs = JSON.parse(list) as { number: number }[];
    if (prs.length === 0) return null;
    return { owner, repo, number: prs[0].number };
  } catch {
    return null;
  }
}

const isGhReady = ghReady();
const pr = findAnyPr();

describe.skipIf(!isGhReady)("github e2e", () => {
  it("gh pr view accepts the getPullRequest --json field list", () => {
    // gh validates --json fields before resolving the branch, so a
    // nonexistent branch still proves the field names are supported.
    const result = spawnSync(
      "gh",
      ["pr", "view", "forge/e2e-no-such-branch", "--json", PR_VIEW_JSON_FIELDS],
      { encoding: "utf8" },
    );
    const stderr = result.stderr ?? "";
    expect(stderr).not.toMatch(/Unknown JSON field/);
    expect(stderr).toMatch(/no pull requests found/);
  });
});

describe.skipIf(!isGhReady || pr === null)("github e2e with real PR", () => {
  const realPr = pr as OpenPr;

  it("getPullRequest resolves a real PR identity", () => {
    const resolved = getPullRequest(String(realPr.number));

    expect(resolved.number).toBe(realPr.number);
    expect(resolved.url).toMatch(/^https:\/\/github\.com\//);
    expect(resolved.owner).toBe(realPr.owner);
    expect(resolved.repo).toBe(realPr.repo);
    expect(resolved.headBranch.length).toBeGreaterThan(0);
  });

  it("getUnresolvedComments runs the GraphQL query and REST call against a real PR", () => {
    const pullRequest = getPullRequest(String(realPr.number));

    const comments = getUnresolvedComments(pullRequest);

    expect(Array.isArray(comments)).toBe(true);
    for (const comment of comments) {
      expect(comment.id.length).toBeGreaterThan(0);
      expect(comment.author.length).toBeGreaterThan(0);
      expect(typeof comment.body).toBe("string");
      expect(typeof comment.createdAt).toBe("string");
      expect(comment.source).toMatch(/^(review|issue)$/);
    }
  });
});

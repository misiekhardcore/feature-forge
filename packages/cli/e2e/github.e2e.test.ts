/**
 * E2E tests for the github module against the real gh CLI.
 *
 * The unit tests in src/github.test.ts mock child_process, which cannot catch
 * gh contract drift (e.g. a `--json` field name gh rejects at runtime, or a
 * GraphQL query gh refuses to run). These tests exercise the real `gh` binary
 * to validate the field list and round-trip the public functions.
 *
 * Skipped when `gh` is not installed or not authenticated, and (like the
 * auth guard) when the live API is unavailable: calls are retried on
 * transient 5xx outages, and a test that still cannot reach GitHub after
 * the retry budget is skipped rather than failed — an outage neither
 * exercises nor disproves the gh contract drift these tests exist to catch.
 *
 * Run via: `npm run test:e2e` (also included in the root `npm run test`).
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";

import { describe, expect, it } from "vitest";

import { GitHubService } from "../src/github";

const gh = new GitHubService();

// ── transient-outage guard ────────────────────────────────────────────────

/** Matches gh CLI failures caused by transient GitHub API outages (HTTP 5xx). */
const TRANSIENT_5XX = /HTTP 5\d\d|no server is currently available|try resubmitting/i;

function isTransient5xx(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_5XX.test(error.message);
}

/**
 * Retry a live API call on transient 5xx outages (gh reports HTTP 503 during
 * brief GitHub incidents). Returns null when every attempt hit the outage.
 */
async function retryOnTransient5xx<T>(fn: () => T, attempts = 4): Promise<T | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!isTransient5xx(error)) throw error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
    }
  }
  return null;
}

/** Run `gh` via spawnSync, retrying while the failure is a transient 5xx outage. */
async function spawnGhRetry(args: string[], attempts = 4): Promise<SpawnSyncReturns<string>> {
  let result = spawnSync("gh", args, { encoding: "utf8" });
  let attempt = 0;
  while (attempt < attempts - 1 && (result.stderr ?? "").match(TRANSIENT_5XX)) {
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    result = spawnSync("gh", args, { encoding: "utf8" });
    attempt += 1;
  }
  return result;
}

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

/** Mirrors the exact `--json` field list used by `GitHubService#getPullRequest`. */
const PR_VIEW_JSON_FIELDS = "number,title,url,headRefName,headRepository";

interface OpenPr {
  owner: string;
  repo: string;
  number: number;
}

/** Find any real PR in the current repo to round-trip against, if one exists. */
function findAnyPr(): OpenPr | null {
  try {
    const nwo = execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      {
        encoding: "utf8",
      },
    ).trim();
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
  it("gh pr view accepts the getPullRequest --json field list", async (ctx) => {
    // gh validates --json fields before resolving the branch, so a
    // nonexistent branch still proves the field names are supported.
    const result = await spawnGhRetry([
      "pr",
      "view",
      "forge/e2e-no-such-branch",
      "--json",
      PR_VIEW_JSON_FIELDS,
    ]);
    const stderr = result.stderr ?? "";
    if (TRANSIENT_5XX.test(stderr)) {
      ctx.skip("GitHub API unavailable (transient 5xx)");
      return;
    }
    expect(stderr).not.toMatch(/Unknown JSON field/);
    expect(stderr).toMatch(/no pull requests found/);
  });
});

describe.skipIf(!isGhReady || pr === null)("github e2e with real PR", () => {
  const realPr = pr as OpenPr;

  it("getPullRequest resolves a real PR identity", async (ctx) => {
    const resolved = await retryOnTransient5xx(() => gh.getPullRequest(String(realPr.number)));
    if (resolved === null) {
      ctx.skip("GitHub API unavailable (transient 5xx)");
      return;
    }

    expect(resolved.number).toBe(realPr.number);
    expect(resolved.url).toMatch(/^https:\/\/github\.com\//);
    expect(resolved.owner).toBe(realPr.owner);
    expect(resolved.repo).toBe(realPr.repo);
    expect(resolved.headBranch.length).toBeGreaterThan(0);
  });

  it("getUnresolvedComments runs the GraphQL query and REST call against a real PR", async (ctx) => {
    const pullRequest = await retryOnTransient5xx(() => gh.getPullRequest(String(realPr.number)));
    if (pullRequest === null) {
      ctx.skip("GitHub API unavailable (transient 5xx)");
      return;
    }

    const comments = await retryOnTransient5xx(() => gh.getUnresolvedComments(pullRequest));
    if (comments === null) {
      ctx.skip("GitHub API unavailable (transient 5xx)");
      return;
    }

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

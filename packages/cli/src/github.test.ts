import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getPullRequest,
  getUnresolvedComments,
  GitHubApiError,
  type PullRequestInfo,
} from "./github";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockExec = vi.mocked(execFileSync);

const PR_VIEW_JSON_FIELDS = "number,title,url,headRefName,headRepository";

const PR_VIEW_PAYLOAD = {
  number: 42,
  title: "Add github module",
  url: "https://github.com/octocat/hello-world/pull/42",
  headRefName: "feat/github-module",
  headRepository: { nameWithOwner: "octocat/hello-world" },
};

const PR: PullRequestInfo = {
  number: 42,
  title: "Add github module",
  url: "https://github.com/octocat/hello-world/pull/42",
  headBranch: "feat/github-module",
  owner: "octocat",
  repo: "hello-world",
};

function mockGhOnce(payload: unknown): void {
  mockExec.mockReturnValueOnce(JSON.stringify(payload));
}

function mockGhThrow(error: Error): void {
  mockExec.mockImplementation(() => {
    throw error;
  });
}

function caughtError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Build `count` valid issue-comment payloads starting at `startId`. */
function makeIssueComments(count: number, startId = 1): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    user: { login: `user-${startId + i}` },
    body: `body ${startId + i}`,
    created_at: "2026-07-04T10:00:00Z",
    html_url: `https://github.com/octocat/hello-world/pull/42#issuecomment-${startId + i}`,
  }));
}

function threadPayload(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
): unknown {
  return {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: { nodes, pageInfo },
        },
      },
    },
  };
}

const THREAD_RESOLVED = {
  id: "thread-resolved",
  isResolved: true,
  comments: {
    nodes: [
      {
        id: "comment-1",
        author: { login: "octocat" },
        body: "already handled",
        path: "src/index.ts",
        line: 10,
        startLine: null,
        createdAt: "2026-07-01T10:00:00Z",
        url: "https://github.com/octocat/hello-world/pull/42#discussion_r1",
      },
    ],
  },
};

const THREAD_OPEN = {
  id: "thread-open",
  isResolved: false,
  comments: {
    nodes: [
      {
        id: "comment-2",
        author: { login: "alice" },
        body: "please add tests",
        path: "src/github.ts",
        line: null,
        startLine: 5,
        createdAt: "2026-07-02T10:00:00Z",
        url: "https://github.com/octocat/hello-world/pull/42#discussion_r2",
      },
      {
        id: "comment-3",
        author: { login: "bob" },
        body: "+1 to that",
        path: "src/github.ts",
        line: 5,
        startLine: null,
        createdAt: "2026-07-03T10:00:00Z",
        url: "https://github.com/octocat/hello-world/pull/42#discussion_r3",
      },
    ],
  },
};

const THREAD_OPEN_FALLBACK = {
  id: "thread-open-fallback",
  isResolved: false,
  comments: {
    nodes: [
      {
        id: "comment-4",
        author: null,
        body: "fallback fields",
        path: null,
        line: null,
        startLine: null,
        createdAt: "2026-07-05T10:00:00Z",
        url: "https://github.com/octocat/hello-world/pull/42#discussion_r4",
      },
    ],
  },
};

const THREADS_PAYLOAD = threadPayload([THREAD_RESOLVED, THREAD_OPEN, THREAD_OPEN_FALLBACK], {
  hasNextPage: false,
  endCursor: null,
});

const ISSUE_COMMENTS_PAYLOAD = [
  {
    id: 900,
    user: { login: "carol" },
    body: "general question about the approach",
    created_at: "2026-07-04T10:00:00Z",
    html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-900",
  },
  {
    id: 901,
    user: null,
    body: "comment without user",
    created_at: "2026-07-05T11:00:00Z",
    html_url: "https://github.com/octocat/hello-world/pull/42#issuecomment-901",
  },
];

describe("github", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  describe("getPullRequest", () => {
    it("calls gh pr view with the branch and parses the response", () => {
      mockGhOnce(PR_VIEW_PAYLOAD);

      const pr = getPullRequest("feat/github-module");

      expect(mockExec).toHaveBeenCalledTimes(1);
      expect(mockExec.mock.calls[0][0]).toBe("gh");
      expect(mockExec.mock.calls[0][1]).toEqual([
        "pr",
        "view",
        "feat/github-module",
        "--json",
        PR_VIEW_JSON_FIELDS,
      ]);
      expect(pr).toEqual(PR);
    });

    it("throws GitHubApiError with cause when gh exits with a non-zero code", () => {
      const cause = new Error(
        "Command failed: gh pr view feat/github-module\ngithub: could not find pull request",
      );
      mockGhThrow(cause);

      const error = caughtError(() => getPullRequest("feat/github-module"));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).name).toBe("GitHubApiError");
      expect((error as GitHubApiError).cause).toBe(cause);
      expect((error as GitHubApiError).message).toContain("could not find pull request");
      expect(mockExec).toHaveBeenCalledTimes(1);
    });

    it("throws when gh returns non-JSON output", () => {
      mockExec.mockReturnValueOnce("oops, not json");

      const error = caughtError(() => getPullRequest("feat/github-module"));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("non-JSON");
    });

    it("throws when the parsed response does not match the expected shape", () => {
      mockGhOnce({ number: "not-a-number", title: "Add github module" });

      const error = caughtError(() => getPullRequest("feat/github-module"));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("unexpected JSON shape");
    });

    it("omits the cause message when gh throws a non-Error value", () => {
      mockExec.mockImplementation(() => {
        throw "boom";
      });

      const error = caughtError(() => getPullRequest("feat/github-module"));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toBe(
        `gh pr view feat/github-module --json ${PR_VIEW_JSON_FIELDS} failed`,
      );
      expect((error as GitHubApiError).cause).toBe("boom");
    });
  });

  describe("getUnresolvedComments", () => {
    it("fetches review threads and issue comments, keeping only unresolved comments", () => {
      mockGhOnce(THREADS_PAYLOAD);
      mockGhOnce(ISSUE_COMMENTS_PAYLOAD);

      const comments = getUnresolvedComments(PR);

      expect(mockExec).toHaveBeenCalledTimes(2);

      const graphqlArgs = mockExec.mock.calls[0][1] as string[];
      expect(mockExec.mock.calls[0][0]).toBe("gh");
      expect(graphqlArgs[0]).toBe("api");
      expect(graphqlArgs[1]).toBe("graphql");
      expect(graphqlArgs).toContain("owner=octocat");
      expect(graphqlArgs).toContain("name=hello-world");
      expect(graphqlArgs).toContain("number=42");
      expect(graphqlArgs).not.toContain("cursor=");
      const queryArg = graphqlArgs.find((arg) => arg.startsWith("query=")) ?? "";
      expect(queryArg).toContain("reviewThreads");
      expect(queryArg).toContain("isResolved");
      expect(queryArg).toContain("pageInfo");
      expect(queryArg).toContain("endCursor");

      const issueArgs = mockExec.mock.calls[1][1] as string[];
      expect(issueArgs).toEqual([
        "api",
        "repos/octocat/hello-world/issues/42/comments?per_page=100&page=1",
      ]);

      expect(comments).toHaveLength(5);
      expect(comments.filter((comment) => comment.source === "review")).toHaveLength(3);
      expect(comments.filter((comment) => comment.source === "issue")).toHaveLength(2);
      expect(comments.some((comment) => comment.id === "comment-1")).toBe(false);
      expect(comments.find((comment) => comment.id === "comment-2")).toMatchObject({
        author: "alice",
        body: "please add tests",
        path: "src/github.ts",
        line: 5,
        source: "review",
        isResolved: false,
        threadId: "thread-open",
      });
      expect(comments.find((comment) => comment.id === "comment-3")).toMatchObject({
        threadId: "thread-open",
        isResolved: false,
      });
      expect(comments.find((comment) => comment.id === "comment-4")).toMatchObject({
        author: "unknown",
        body: "fallback fields",
        path: "",
        line: null,
        source: "review",
        isResolved: false,
        threadId: "thread-open-fallback",
      });
      expect(comments.find((comment) => comment.id === "900")).toMatchObject({
        author: "carol",
        body: "general question about the approach",
        url: "https://github.com/octocat/hello-world/pull/42#issuecomment-900",
        source: "issue",
        isResolved: false,
        threadId: null,
        path: "",
        line: null,
      });
      expect(comments.find((comment) => comment.id === "901")).toMatchObject({
        author: "unknown",
        source: "issue",
      });
    });

    it("returns empty when all threads resolved and no issue comments exist", () => {
      mockGhOnce(threadPayload([THREAD_RESOLVED], { hasNextPage: false, endCursor: null }));
      mockGhOnce([]);

      const comments = getUnresolvedComments(PR);

      expect(comments).toHaveLength(0);
    });

    it("follows the reviewThreads cursor across pages and merges comments", () => {
      mockGhOnce(threadPayload([THREAD_OPEN], { hasNextPage: true, endCursor: "cursor-1" }));
      mockGhOnce(threadPayload([THREAD_OPEN_FALLBACK], { hasNextPage: false, endCursor: null }));
      mockGhOnce(ISSUE_COMMENTS_PAYLOAD);

      const comments = getUnresolvedComments(PR);

      expect(mockExec).toHaveBeenCalledTimes(3);
      const secondPageArgs = mockExec.mock.calls[1][1] as string[];
      expect(secondPageArgs).toContain("cursor=cursor-1");
      expect(comments.filter((comment) => comment.source === "review")).toHaveLength(3);
      expect(comments.find((comment) => comment.id === "comment-2")).toBeDefined();
      expect(comments.find((comment) => comment.id === "comment-4")).toBeDefined();
    });

    it("follows the issue comment page loop until a short page", () => {
      mockGhOnce(threadPayload([], { hasNextPage: false, endCursor: null }));
      mockGhOnce(makeIssueComments(100));
      mockGhOnce(makeIssueComments(2, 1000));

      const comments = getUnresolvedComments(PR);

      expect(mockExec).toHaveBeenCalledTimes(3);
      const secondIssuePage = mockExec.mock.calls[2][1] as string[];
      expect(secondIssuePage).toEqual([
        "api",
        "repos/octocat/hello-world/issues/42/comments?per_page=100&page=2",
      ]);
      expect(comments.filter((comment) => comment.source === "issue")).toHaveLength(102);
    });

    it("throws GitHubApiError when the GraphQL response reports errors with null data", () => {
      mockGhOnce({ data: null, errors: [{ message: "Something went wrong fetching threads" }] });

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("Something went wrong fetching threads");
    });

    it("falls back to unknown error when the GraphQL response has no errors array", () => {
      mockGhOnce({ data: null });

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("unknown error");
    });

    it("breaks out of thread pagination when hasNextPage is true but endCursor is null", () => {
      mockGhOnce(threadPayload([THREAD_OPEN], { hasNextPage: true, endCursor: null }));
      mockGhOnce(ISSUE_COMMENTS_PAYLOAD);

      const comments = getUnresolvedComments(PR);

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(comments.find((comment) => comment.id === "comment-2")).toBeDefined();
      expect(comments.filter((comment) => comment.source === "issue")).toHaveLength(2);
    });

    it("throws when the parsed threads response does not match the expected shape", () => {
      mockGhOnce({ data: { repository: {} } });

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("unexpected JSON shape");
    });

    it("throws when the parsed threads payload is not an object at all", () => {
      mockGhOnce(null);

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("unexpected JSON shape");
    });

    it("aborts with GitHubApiError when review thread pagination exceeds the cap", () => {
      mockExec.mockImplementation(() =>
        JSON.stringify(threadPayload([], { hasNextPage: true, endCursor: "cursor-loop" })),
      );

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("reviewThreads pagination exceeded");
      expect(mockExec).toHaveBeenCalledTimes(5);
    });

    it("aborts with GitHubApiError when issue comment pagination exceeds the cap", () => {
      let calls = 0;
      mockExec.mockImplementation(() => {
        calls += 1;
        if (calls === 1) {
          return JSON.stringify(threadPayload([], { hasNextPage: false, endCursor: null }));
        }
        return JSON.stringify(makeIssueComments(100));
      });

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).message).toContain("issue comment pagination exceeded");
      expect(mockExec).toHaveBeenCalledTimes(11);
    });

    it("throws GitHubApiError with cause when the gh api call fails", () => {
      const cause = new Error("Command failed: gh api graphql\nHTTP 500");
      mockGhThrow(cause);

      const error = caughtError(() => getUnresolvedComments(PR));

      expect(error).toBeInstanceOf(GitHubApiError);
      expect((error as GitHubApiError).name).toBe("GitHubApiError");
      expect((error as GitHubApiError).cause).toBe(cause);
      expect((error as GitHubApiError).message).toContain("HTTP 500");
    });
  });
});

import { execFileSync } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPullRequest, getUnresolvedComments, type PullRequestInfo } from "./github";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockExec = vi.mocked(execFileSync);

const PR_VIEW_PAYLOAD = {
  number: 42,
  title: "Add github module",
  url: "https://github.com/octocat/hello-world/pull/42",
  headRefName: "feat/github-module",
  repository: { nameWithOwner: "octocat/hello-world" },
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
        "number,title,url,headRefName,repository",
      ]);
      expect(pr).toEqual(PR);
    });

    it("throws when gh exits with a non-zero code", () => {
      mockGhThrow(
        new Error(
          "Command failed: gh pr view feat/github-module\ngithub: could not find pull request",
        ),
      );

      expect(() => getPullRequest("feat/github-module")).toThrow("could not find pull request");
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });

  describe("getUnresolvedComments", () => {
    const threadsPayload = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
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
                },
                {
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
                },
                {
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
                },
              ],
            },
          },
        },
      },
    };

    const issueCommentsPayload = [
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

    it("fetches review threads and issue comments, keeping only unresolved comments", () => {
      mockGhOnce(threadsPayload);
      mockGhOnce(issueCommentsPayload);

      const comments = getUnresolvedComments(PR);

      expect(mockExec).toHaveBeenCalledTimes(2);

      const graphqlArgs = mockExec.mock.calls[0][1] as string[];
      expect(mockExec.mock.calls[0][0]).toBe("gh");
      expect(graphqlArgs[0]).toBe("api");
      expect(graphqlArgs[1]).toBe("graphql");
      expect(graphqlArgs).toContain("owner=octocat");
      expect(graphqlArgs).toContain("name=hello-world");
      expect(graphqlArgs).toContain("number=42");
      const queryArg = graphqlArgs.find((arg) => arg.startsWith("query=")) ?? "";
      expect(queryArg).toContain("reviewThreads");
      expect(queryArg).toContain("isResolved");

      const issueArgs = mockExec.mock.calls[1][1] as string[];
      expect(issueArgs).toEqual([
        "api",
        "repos/octocat/hello-world/issues/42/comments?per_page=100",
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

    it("returns only issue comments when all review threads are resolved", () => {
      mockGhOnce({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
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
                  },
                ],
              },
            },
          },
        },
      });
      mockGhOnce([]);

      const comments = getUnresolvedComments(PR);

      expect(comments).toHaveLength(0);
    });

    it("throws when the gh api call fails", () => {
      mockGhThrow(new Error("Command failed: gh api graphql\nHTTP 500"));

      expect(() => getUnresolvedComments(PR)).toThrow("HTTP 500");
    });
  });
});

import { execFileSync } from "node:child_process";

// ─── Error type ────────────────────────────────────────────────────────────

/**
 * Error thrown when a gh CLI call fails: non-zero exit, unparseable output,
 * or a response that does not match the expected shape. The underlying
 * failure is preserved in `cause` so callers can distinguish gh failures
 * from domain errors.
 */
export class GitHubApiError extends Error {
  override readonly name = "GitHubApiError";

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

/** Pull request identity resolved from `gh pr view` output. */
export interface PullRequestInfo {
  /** Pull request number. */
  number: number;
  /** Pull request title. */
  title: string;
  /** URL of the pull request on github.com. */
  url: string;
  /** Branch name the pull request was opened from. */
  headBranch: string;
  /** Repository owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
}

/**
 * Where a comment originated.
 *
 * - `"review"` — an inline diff comment grouped into a review thread;
 *   resolved state is tracked per thread.
 * - `"issue"` — a general PR-level comment on the issue timeline; these
 *   are always considered unresolved (only the 👍 reaction marks them done).
 */
export type CommentSource = "review" | "issue";

/** A single PR comment fed into the triage step of `/resolve-pr-feedback`. */
export interface GitHubComment {
  /** Stable comment id (GraphQL node id for review, numeric id for issue). */
  id: string;
  /** Login of the author, or `"unknown"` when the author is unavailable. */
  author: string;
  /** Markdown body of the comment. */
  body: string;
  /** File path the comment is attached to (empty for issue comments). */
  path: string;
  /** Line number in the diff, when available. */
  line: number | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Public URL to the comment on github.com. */
  url: string;
  /** Where the comment originated — see {@link CommentSource}. */
  source: CommentSource;
  /** Whether the review thread the comment belongs to is resolved. */
  isResolved: boolean;
  /** Review thread id; `null` for issue comments. */
  threadId: string | null;
}

// ─── Response shapes ───────────────────────────────────────────────────────

/** Shape of `gh pr view --json number,title,url,headRefName,headRepository`. */
interface PrViewData {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRepository: { nameWithOwner: string };
}

/** A single comment inside a review thread. */
interface ReviewThreadComment {
  id: string;
  author: { login: string } | null;
  body: string;
  path: string | null;
  line: number | null;
  startLine: number | null;
  createdAt: string;
  url: string;
}

/** A GraphQL review thread with its comments. */
interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: { nodes: ReviewThreadComment[] };
}

/** One page of review threads plus cursor pagination metadata. */
interface ReviewThreadsPage {
  nodes: ReviewThread[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/**
 * Shape of the `reviewThreads` GraphQL response. `data` is `null` when the
 * query fails (e.g. rate limit); the reason is then in `errors`.
 */
interface ReviewThreadsResponse {
  data: {
    repository: {
      pullRequest: { reviewThreads: ReviewThreadsPage };
    };
  } | null;
  errors?: { message: string }[];
}

/** Shape of a REST issue-comment item. */
interface IssueComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  html_url: string;
}

// ─── Runtime validation ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrViewData(value: unknown): value is PrViewData {
  return (
    isRecord(value) &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.headRefName === "string" &&
    isRecord(value.headRepository) &&
    typeof value.headRepository.nameWithOwner === "string"
  );
}

function isReviewThreadsResponse(value: unknown): value is ReviewThreadsResponse {
  if (!isRecord(value)) return false;
  if (value.data === null) return true;
  return (
    isRecord(value.data) &&
    isRecord(value.data.repository) &&
    isRecord(value.data.repository.pullRequest) &&
    isRecord(value.data.repository.pullRequest.reviewThreads) &&
    Array.isArray(value.data.repository.pullRequest.reviewThreads.nodes) &&
    isRecord(value.data.repository.pullRequest.reviewThreads.pageInfo) &&
    typeof value.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage === "boolean"
  );
}

function isIssueComment(value: unknown): value is IssueComment {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.body === "string" &&
    typeof value.created_at === "string" &&
    typeof value.html_url === "string" &&
    (value.user === null || (isRecord(value.user) && typeof value.user.login === "string"))
  );
}

function isIssueCommentList(value: unknown): value is IssueComment[] {
  return Array.isArray(value) && value.every(isIssueComment);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/** Cap on review-thread pages fetched (100 threads per page). */
const MAX_REVIEW_THREAD_PAGES = 5;
/** Cap on issue-comment pages fetched (100 comments per page). */
const MAX_ISSUE_COMMENT_PAGES = 10;

/**
 * Run `gh <args>` and return the parsed, shape-validated JSON output.
 *
 * @throws {@link GitHubApiError} when gh exits non-zero, the output is not
 *   JSON, or the parsed value fails `validate`.
 */
function ghJson<T>(args: string[], validate: (value: unknown) => value is T): T {
  let output: string;
  try {
    output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const causeMessage = error instanceof Error ? `: ${error.message}` : "";
    throw new GitHubApiError(`gh ${args.join(" ")} failed${causeMessage}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new GitHubApiError(`gh ${args.join(" ")} returned non-JSON output`, { cause: error });
  }

  if (!validate(parsed)) {
    throw new GitHubApiError(`gh ${args.join(" ")} returned an unexpected JSON shape`);
  }
  return parsed;
}

/** Run `gh api <endpoint>` with extra args and parse the validated JSON. */
function ghApi<T>(endpoint: string, args: string[], validate: (value: unknown) => value is T): T {
  return ghJson<T>(["api", endpoint, ...args], validate);
}

// ─── API functions ─────────────────────────────────────────────────────────

/**
 * Resolve a pull request by branch name (or number) into its identity.
 *
 * @param branch - Branch name the PR was opened from (also accepts a PR
 *   number as a string).
 * @returns The PR number, title, URL, head branch, and `owner/repo`.
 * @throws {@link GitHubApiError} when the PR cannot be found or the gh
 *   response does not match the expected shape.
 */
export function getPullRequest(branch: string): PullRequestInfo {
  const data = ghJson<PrViewData>(
    ["pr", "view", branch, "--json", "number,title,url,headRefName,headRepository"],
    isPrViewData,
  );
  const [owner, repo] = data.headRepository.nameWithOwner.split("/");
  return {
    number: data.number,
    title: data.title,
    url: data.url,
    headBranch: data.headRefName,
    owner,
    repo,
  };
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            id
            isResolved
            comments(first: 100) {
              nodes {
                id
                author { login }
                body
                path
                line
                startLine
                createdAt
                url
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

/**
 * Fetch all review threads of a PR, following the GraphQL cursor until the
 * last page. Aborts with {@link GitHubApiError} if the page cap is hit.
 */
function fetchReviewThreads(pr: PullRequestInfo): ReviewThread[] {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (true) {
    if (page >= MAX_REVIEW_THREAD_PAGES) {
      throw new GitHubApiError(
        `reviewThreads pagination exceeded ${MAX_REVIEW_THREAD_PAGES} pages ` +
          `(${MAX_REVIEW_THREAD_PAGES * 100} threads); aborting, results would be truncated`,
      );
    }
    const args = [
      "-f",
      `query=${REVIEW_THREADS_QUERY}`,
      "-F",
      `owner=${pr.owner}`,
      "-F",
      `name=${pr.repo}`,
      "-F",
      `number=${pr.number}`,
    ];
    if (cursor !== null) {
      args.push("-F", `cursor=${cursor}`);
    }

    const response = ghApi<ReviewThreadsResponse>("graphql", args, isReviewThreadsResponse);
    if (response.data === null) {
      const reason = response.errors?.map((error) => error.message).join("; ") ?? "unknown error";
      throw new GitHubApiError(`GitHub reviewThreads query failed: ${reason}`);
    }

    const reviewThreads = response.data.repository.pullRequest.reviewThreads;
    threads.push(...reviewThreads.nodes);

    if (!reviewThreads.pageInfo.hasNextPage) break;
    const nextCursor = reviewThreads.pageInfo.endCursor;
    if (nextCursor === null) break;
    cursor = nextCursor;
    page += 1;
  }

  return threads;
}

/**
 * Fetch all issue comments of a PR, following REST `page` parameters until a
 * short page. Aborts with {@link GitHubApiError} if the page cap is hit.
 */
function fetchIssueComments(pr: PullRequestInfo): IssueComment[] {
  const comments: IssueComment[] = [];
  for (let page = 1; page <= MAX_ISSUE_COMMENT_PAGES; page += 1) {
    const batch = ghApi<IssueComment[]>(
      `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments?per_page=100&page=${page}`,
      [],
      isIssueCommentList,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  if (comments.length >= MAX_ISSUE_COMMENT_PAGES * 100) {
    throw new GitHubApiError(
      `issue comment pagination exceeded ${MAX_ISSUE_COMMENT_PAGES * 100} comments; ` +
        "aborting, results would be truncated",
    );
  }
  return comments;
}

/**
 * Fetch all unresolved comments on a pull request.
 *
 * Review comments are flattened per thread (one `GitHubComment` per comment
 * node) and filtered to unresolved threads only; issue comments are all
 * returned since they have no resolved state. Both sources are paginated to
 * completion (GraphQL cursor for threads, REST `page` for issue comments).
 *
 * @param pr - The pull request identity from {@link getPullRequest}.
 * @returns Unresolved review comments followed by issue comments, newest
 *   semantic order preserved per source.
 * @throws {@link GitHubApiError} when a gh call fails, the GraphQL query
 *   reports errors, the response shape is invalid, or a pagination cap is
 *   exceeded.
 */
export function getUnresolvedComments(pr: PullRequestInfo): GitHubComment[] {
  const reviewComments: GitHubComment[] = [];
  for (const thread of fetchReviewThreads(pr)) {
    for (const comment of thread.comments.nodes) {
      reviewComments.push({
        id: comment.id,
        author: comment.author?.login ?? "unknown",
        body: comment.body,
        path: comment.path ?? "",
        line: comment.line ?? comment.startLine ?? null,
        createdAt: comment.createdAt,
        url: comment.url,
        source: "review",
        isResolved: thread.isResolved,
        threadId: thread.id,
      });
    }
  }

  const issueComments: GitHubComment[] = fetchIssueComments(pr).map((comment) => ({
    id: String(comment.id),
    author: comment.user?.login ?? "unknown",
    body: comment.body,
    path: "",
    line: null,
    createdAt: comment.created_at,
    url: comment.html_url,
    source: "issue",
    isResolved: false,
    threadId: null,
  }));

  return [...reviewComments.filter((comment) => !comment.isResolved), ...issueComments];
}

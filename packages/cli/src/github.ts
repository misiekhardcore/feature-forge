import { execFileSync } from "node:child_process";

// ─── Types ──────────────────────────────────────────────────────────────

export interface PullRequestInfo {
  /** Pull request number. */
  number: number;
  /** Pull request title. */
  title: string;
  /** URL of the pull request. */
  url: string;
  /** Branch name the pull request was opened from. */
  headBranch: string;
  /** Repository owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
}

export type CommentSource = "review" | "issue";

export interface GitHubComment {
  id: string;
  author: string;
  body: string;
  /** File path the comment is attached to (empty for issue comments). */
  path: string;
  /** Line number in the diff, when available. */
  line: number | null;
  createdAt: string;
  url: string;
  source: CommentSource;
  isResolved: boolean;
  /** Review thread id; null for issue comments. */
  threadId: string | null;
}

// ─── Response shapes ────────────────────────────────────────────────────

interface PrViewData {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  repository: { nameWithOwner: string };
}

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

interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: { nodes: ReviewThreadComment[] };
}

interface ReviewThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: ReviewThread[] };
      };
    };
  };
}

interface IssueComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
  html_url: string;
}

// ─── Internal helpers ───────────────────────────────────────────────────

function ghJson<T>(args: string[]): T {
  const output = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(output) as T;
}

function ghApi<T>(endpoint: string, args: string[] = []): T {
  return ghJson<T>(["api", endpoint, ...args]);
}

// ─── API functions ──────────────────────────────────────────────────────

export function getPullRequest(branch: string): PullRequestInfo {
  const data = ghJson<PrViewData>([
    "pr",
    "view",
    branch,
    "--json",
    "number,title,url,headRefName,repository",
  ]);
  const [owner, repo] = data.repository.nameWithOwner.split("/");
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
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
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
        }
      }
    }
  }
`;

export function getUnresolvedComments(pr: PullRequestInfo): GitHubComment[] {
  const threads = ghApi<ReviewThreadsResponse>("graphql", [
    "-f",
    `query=${REVIEW_THREADS_QUERY}`,
    "-F",
    `owner=${pr.owner}`,
    "-F",
    `name=${pr.repo}`,
    "-F",
    `number=${pr.number}`,
  ]);

  const reviewComments: GitHubComment[] = [];
  for (const thread of threads.data.repository.pullRequest.reviewThreads.nodes) {
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

  const issueComments = ghApi<IssueComment[]>(
    `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments?per_page=100`,
  );
  const issueCommentShapes: GitHubComment[] = issueComments.map((comment) => ({
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

  return [...reviewComments.filter((comment) => !comment.isResolved), ...issueCommentShapes];
}
